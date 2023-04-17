/**
 * Built-in node library.
 *
 * Each definition is self-describing — ports, field schema, description —
 * so the palette, the inspector form and the validator are all generated
 * from this file. Adding a node is one object here and nothing else.
 */

import { getPath } from '@/engine/template'
import type { NodeDefinition } from '@/engine/types'

const OPERATORS = ['equals', 'not equals', 'greater than', 'less than', 'contains', 'exists', 'is empty'] as const

export function compare(left: unknown, op: string, right: unknown): boolean {
  // Loose numeric comparison on purpose: values arriving from templates and
  // JSON are often "200" vs 200, and a low-code user should not need to know.
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
  switch (op) {
    case 'equals':
      return !Number.isNaN(num(left)) && !Number.isNaN(num(right)) ? num(left) === num(right) : String(left) === String(right)
    case 'not equals':
      return !compare(left, 'equals', right)
    case 'greater than':
      return num(left) > num(right)
    case 'less than':
      return num(left) < num(right)
    case 'contains':
      return Array.isArray(left) ? left.some((x) => compare(x, 'equals', right)) : String(left ?? '').includes(String(right))
    case 'exists':
      return left !== undefined && left !== null
    case 'is empty':
      return left === undefined || left === null || left === '' || (Array.isArray(left) && left.length === 0) ||
        (typeof left === 'object' && Object.keys(left as object).length === 0)
    default:
      throw new Error(`unknown operator "${op}"`)
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')) }, { once: true })
  })
}

function parseJsonField(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${field} is not valid JSON`)
  }
}

export const nodes: NodeDefinition[] = [
  {
    type: 'trigger.manual',
    label: 'Manual trigger',
    category: 'Triggers',
    description: 'Starts the workflow when you press Run, emitting a fixed JSON payload.',
    inputs: [],
    outputs: [{ name: 'payload', type: 'object' }],
    fields: [{ key: 'payload', label: 'Payload', kind: 'json', default: { host: 'example.com' } }],
    async run({ config }) {
      return { payload: parseJsonField(config.payload, 'Payload') }
    },
  },
  {
    type: 'net.http',
    label: 'HTTP request',
    category: 'Network',
    description: 'Calls a URL. Routes to "ok" for 2xx responses and to "failed" otherwise, so error handling is a branch, not an exception.',
    inputs: [{ name: 'body', type: 'any', label: 'Body' }, { name: 'trigger', type: 'any', label: 'Trigger' }],
    outputs: [{ name: 'ok', type: 'object', label: 'OK' }, { name: 'failed', type: 'object', label: 'Failed' }],
    fields: [
      { key: 'method', label: 'Method', kind: 'select', default: 'GET', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'url', label: 'URL', kind: 'text', default: 'https://httpbin.org/get', help: 'Supports {{ input.payload.host }} placeholders' },
      { key: 'headers', label: 'Headers', kind: 'json', default: {} },
    ],
    timeoutMs: 15000,
    async run({ inputs, config, signal, log }) {
      const headers = parseJsonField(config.headers, 'Headers') as Record<string, string>
      const method = String(config.method)
      const hasBody = method !== 'GET' && inputs.body !== undefined
      const started = performance.now()
      let res: Response
      try {
        res = await fetch(String(config.url), {
          method,
          headers: hasBody ? { 'Content-Type': 'application/json', ...headers } : headers,
          body: hasBody ? JSON.stringify(inputs.body) : undefined,
          signal,
        })
      } catch (err) {
        if (signal.aborted) throw err
        // Browsers report DNS failures, refused connections and CORS
        // rejections as the same opaque TypeError. Routing it to "failed"
        // keeps it a branch the workflow can handle, and the hint saves the
        // user from guessing which of the three it was.
        log(`${method} ${config.url} → network error`)
        return { failed: { status: 0, ok: false, error: 'network error (unreachable, or blocked by CORS)', url: config.url } }
      }
      const text = await res.text()
      let body: unknown = text
      try { body = JSON.parse(text) } catch { /* keep as text */ }
      const result = { status: res.status, ok: res.ok, ms: Math.round(performance.now() - started), headers: Object.fromEntries(res.headers), body }
      log(`${method} ${config.url} → ${res.status} in ${result.ms} ms`)
      return res.ok ? { ok: result } : { failed: result }
    },
  },
  {
    type: 'net.dns',
    label: 'DNS lookup',
    category: 'Network',
    description: 'Resolves a name over DNS-over-HTTPS (works from the browser, no backend needed).',
    inputs: [{ name: 'trigger', type: 'any', label: 'Trigger' }],
    outputs: [{ name: 'records', type: 'array' }, { name: 'failed', type: 'object' }],
    fields: [
      { key: 'name', label: 'Name', kind: 'text', default: '{{ input.trigger.host }}' },
      { key: 'type', label: 'Record', kind: 'select', default: 'A', options: ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT'] },
      { key: 'resolver', label: 'Resolver', kind: 'select', default: 'cloudflare', options: ['cloudflare', 'google'] },
    ],
    timeoutMs: 8000,
    async run({ config, signal, log }) {
      const base = config.resolver === 'google' ? 'https://dns.google/resolve' : 'https://cloudflare-dns.com/dns-query'
      const url = `${base}?name=${encodeURIComponent(String(config.name))}&type=${config.type}`
      let res: Response
      try {
        res = await fetch(url, { headers: { Accept: 'application/dns-json' }, signal })
      } catch (err) {
        if (signal.aborted) throw err
        log(`resolver unreachable: ${base}`)
        return { failed: { name: config.name, error: 'resolver unreachable' } }
      }
      const data = await res.json() as { Status: number; Answer?: { data: string; TTL: number }[] }
      // RCODE 3 is NXDOMAIN; anything non-zero is a resolution failure the
      // workflow should be able to branch on rather than crash.
      if (data.Status !== 0) {
        log(`${config.name}: rcode ${data.Status}`)
        return { failed: { name: config.name, rcode: data.Status } }
      }
      const records = (data.Answer ?? []).map((a) => ({ value: a.data, ttl: a.TTL }))
      log(`${config.name} ${config.type}: ${records.map((r) => r.value).join(', ') || 'no records'}`)
      return { records }
    },
  },
  {
    type: 'data.pick',
    label: 'Pick field',
    category: 'Data',
    description: 'Extracts one value by path, e.g. body.items[0].name.',
    inputs: [{ name: 'in', type: 'any', required: true }],
    outputs: [{ name: 'out', type: 'any' }],
    fields: [{ key: 'path', label: 'Path', kind: 'text', default: 'body', placeholder: 'body.items[0].name' }],
    async run({ inputs, config }) {
      return { out: getPath(inputs.in, String(config.path)) }
    },
  },
  {
    type: 'data.filter',
    label: 'Filter list',
    category: 'Data',
    description: 'Keeps the items of a list whose field matches a condition.',
    inputs: [{ name: 'in', type: 'array', required: true }],
    outputs: [{ name: 'out', type: 'array' }],
    fields: [
      { key: 'path', label: 'Field', kind: 'text', default: 'status' },
      { key: 'operator', label: 'Operator', kind: 'select', default: 'equals', options: [...OPERATORS] },
      { key: 'value', label: 'Value', kind: 'text', default: '' },
    ],
    async run({ inputs, config }) {
      if (!Array.isArray(inputs.in)) throw new Error('input is not a list')
      return { out: inputs.in.filter((item) => compare(getPath(item, String(config.path)), String(config.operator), config.value)) }
    },
  },
  {
    type: 'data.template',
    label: 'Text template',
    category: 'Data',
    description: 'Builds a string from upstream data with {{ placeholders }}.',
    inputs: [{ name: 'in', type: 'any', required: true }],
    outputs: [{ name: 'text', type: 'string' }],
    fields: [{ key: 'template', label: 'Template', kind: 'textarea', default: 'Status: {{ in.status }}' }],
    async run({ config }) {
      return { text: String(config.template ?? '') }
    },
  },
  {
    type: 'logic.condition',
    label: 'Condition',
    category: 'Logic',
    description: 'Routes the input to "true" or "false". The other branch is skipped downstream.',
    inputs: [{ name: 'in', type: 'any', required: true }],
    outputs: [{ name: 'true', type: 'any', label: 'True' }, { name: 'false', type: 'any', label: 'False' }],
    fields: [
      { key: 'left', label: 'Value', kind: 'text', default: '{{ in.status }}' },
      { key: 'operator', label: 'Operator', kind: 'select', default: 'equals', options: [...OPERATORS] },
      { key: 'right', label: 'Compare to', kind: 'text', default: '200' },
    ],
    async run({ inputs, config, log }) {
      const result = compare(config.left, String(config.operator), config.right)
      log(`${JSON.stringify(config.left)} ${config.operator} ${JSON.stringify(config.right)} → ${result}`)
      return result ? { true: inputs.in } : { false: inputs.in }
    },
  },
  {
    type: 'logic.merge',
    label: 'Merge',
    category: 'Logic',
    description: 'Joins branches. Runs when any input arrives; outputs the first value or all values.',
    inputs: [{ name: 'a', type: 'any', label: 'A' }, { name: 'b', type: 'any', label: 'B' }, { name: 'c', type: 'any', label: 'C' }],
    outputs: [{ name: 'out', type: 'any' }],
    fields: [{ key: 'mode', label: 'Mode', kind: 'select', default: 'first', options: ['first', 'all'] }],
    async run({ inputs, config }) {
      const present = ['a', 'b', 'c'].filter((k) => k in inputs)
      return { out: config.mode === 'all' ? Object.fromEntries(present.map((k) => [k, inputs[k]])) : inputs[present[0]!] }
    },
  },
  {
    type: 'logic.delay',
    label: 'Delay',
    category: 'Logic',
    description: 'Waits, then passes the input through. Cancelling the run interrupts the wait.',
    inputs: [{ name: 'in', type: 'any', required: true }],
    outputs: [{ name: 'out', type: 'any' }],
    fields: [{ key: 'ms', label: 'Milliseconds', kind: 'number', default: 1000, min: 0, max: 600000 }],
    async run({ inputs, config, signal }) {
      await sleep(Number(config.ms), signal)
      return { out: inputs.in }
    },
  },
  {
    type: 'output.result',
    label: 'Result',
    category: 'Output',
    description: 'Shows a value in the run panel. Use it to inspect what reaches the end of a branch.',
    inputs: [{ name: 'value', type: 'any', required: true }],
    outputs: [],
    fields: [{ key: 'title', label: 'Title', kind: 'text', default: 'Result' }],
    async run({ inputs, config }) {
      return { title: config.title, value: inputs.value }
    },
  },
]

export const definitions: Record<string, NodeDefinition> = Object.fromEntries(nodes.map((n) => [n.type, n]))
