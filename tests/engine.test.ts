import { describe, expect, it } from 'vitest'

import { execute, WorkflowError } from '@/engine/executor'
import { canConnect, createsCycle, topoSort, validate } from '@/engine/graph'
import { History } from '@/engine/history'
import { CURRENT_VERSION, ImportError, migrate } from '@/engine/serialize'
import { getPath, render } from '@/engine/template'
import type { NodeDefinition, Workflow, WorkflowEdge, WorkflowNode } from '@/engine/types'
import { compare, definitions } from '@/nodes'

const node = (id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id, type, config, position: { x: 0, y: 0 },
})
const edge = (from: string, fp: string, to: string, tp: string): WorkflowEdge => ({
  id: `${from}.${fp}->${to}.${tp}`, from: { node: from, port: fp }, to: { node: to, port: tp },
})
const wf = (nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow => ({ version: CURRENT_VERSION, name: 't', nodes, edges })

// Test-only nodes with controllable timing and failures.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const testDefs: Record<string, NodeDefinition> = {
  ...definitions,
  'test.slow': {
    type: 'test.slow', label: 'Slow', category: 'Data', description: '', fields: [{ key: 'ms', label: 'ms', kind: 'number', default: 50 }],
    inputs: [{ name: 'in', type: 'any' }], outputs: [{ name: 'out', type: 'any' }],
    async run({ inputs, config }) { await sleep(Number(config.ms)); return { out: inputs.in } },
  },
  'test.fail': {
    type: 'test.fail', label: 'Fail', category: 'Data', description: '', fields: [],
    inputs: [{ name: 'in', type: 'any' }], outputs: [{ name: 'out', type: 'any' }],
    async run() { throw new Error('boom') },
  },
  'test.hang': {
    type: 'test.hang', label: 'Hang', category: 'Data', description: '', fields: [], timeoutMs: 50,
    inputs: [{ name: 'in', type: 'any' }], outputs: [{ name: 'out', type: 'any' }],
    run: () => new Promise(() => {}), // ignores its abort signal entirely
  },
}

describe('graph', () => {
  it('reports every node on or after a cycle', () => {
    const g = wf([node('a', 'test.slow'), node('b', 'test.slow'), node('c', 'test.slow')],
      [edge('a', 'out', 'b', 'in'), edge('b', 'out', 'c', 'in'), edge('c', 'out', 'b', 'in')])
    const { order, cyclic } = topoSort(g)
    expect(order).toEqual(['a'])
    expect(cyclic.sort()).toEqual(['b', 'c'])
  })

  it('refuses connections that would create a loop or mismatch types', () => {
    const g = wf([node('t', 'trigger.manual'), node('f', 'data.filter'), node('p', 'data.pick')],
      [edge('t', 'payload', 'p', 'in'), edge('p', 'out', 'f', 'in')])
    expect(createsCycle(g, 'f', 'p')).toBe(true)
    const mismatch = canConnect(g, definitions, { node: 't', port: 'payload' }, { node: 'f', port: 'in' })
    expect(mismatch).toEqual({ ok: false, reason: 'object output cannot feed a array input' })
  })

  it('validates required inputs, fan-in and missing triggers', () => {
    const g = wf([node('p', 'data.pick'), node('a', 'data.pick'), node('b', 'data.pick'), node('m', 'data.template')],
      [edge('a', 'out', 'm', 'in'), edge('b', 'out', 'm', 'in')])
    const msgs = validate(g, definitions).map((i) => i.message)
    expect(msgs).toContain('Pick field: input "in" is not connected')
    expect(msgs).toContain('Text template: input "in" has 2 connections')
    expect(msgs).toContain('no trigger node: nothing will start this workflow')
  })
})

describe('template', () => {
  it('reads nested paths and array indices', () => {
    expect(getPath({ a: { b: [{ c: 7 }] } }, 'a.b[0].c')).toBe(7)
  })

  it('keeps the type when the field is a single placeholder', () => {
    expect(render('{{ in.n }}', { in: { n: 42 } })).toBe(42)
    expect(render('n = {{ in.n }}', { in: { n: 42 } })).toBe('n = 42')
  })

  it('cannot walk the prototype chain', () => {
    expect(getPath({}, '__proto__.constructor')).toBeUndefined()
    expect(getPath({ a: 1 }, 'a.constructor.name')).toBeUndefined()
    expect(render('{{ x.toString }}', { x: {} })).toBeUndefined()
  })
})

describe('executor', () => {
  it('runs independent branches in parallel', async () => {
    const g = wf(
      [node('t', 'trigger.manual'), node('a', 'test.slow', { ms: 100 }), node('b', 'test.slow', { ms: 100 }), node('c', 'test.slow', { ms: 100 })],
      [edge('t', 'payload', 'a', 'in'), edge('t', 'payload', 'b', 'in'), edge('t', 'payload', 'c', 'in')],
    )
    const res = await execute(g, testDefs)
    expect(res.status).toBe('success')
    expect(res.durationMs).toBeLessThan(250)
  })

  it('does not hold a fast branch behind a slow sibling', async () => {
    const finished: string[] = []
    const g = wf(
      [node('t', 'trigger.manual'), node('slow', 'test.slow', { ms: 150 }), node('fast', 'test.slow', { ms: 10 }), node('after', 'test.slow', { ms: 10 })],
      [edge('t', 'payload', 'slow', 'in'), edge('t', 'payload', 'fast', 'in'), edge('fast', 'out', 'after', 'in')],
    )
    await execute(g, testDefs, { onUpdate: (id, s) => { if (s.status === 'success') finished.push(id) } })
    expect(finished.indexOf('after')).toBeLessThan(finished.indexOf('slow'))
  })

  it('routes through a condition and skips the other branch', async () => {
    const g = wf(
      [node('t', 'trigger.manual', { payload: { status: 503 } }),
       node('c', 'logic.condition', { left: '{{ in.status }}', operator: 'equals', right: '200' }),
       node('yes', 'output.result'), node('no', 'output.result'),
       node('after-yes', 'test.slow', { ms: 1 })],
      [edge('t', 'payload', 'c', 'in'), edge('c', 'true', 'yes', 'value'), edge('c', 'false', 'no', 'value'),
       edge('yes', 'value', 'after-yes', 'in')],
    )
    const res = await execute(g, testDefs)
    expect(res.states.no!.status).toBe('success')
    expect(res.states.yes!.status).toBe('skipped')
    expect(res.states['after-yes']!.status).toBe('skipped')
  })

  it('merge runs once with whichever branch fired', async () => {
    const g = wf(
      [node('t', 'trigger.manual', { payload: { v: 1 } }),
       node('c', 'logic.condition', { left: '{{ in.v }}', operator: 'equals', right: '1' }),
       node('m', 'logic.merge'), node('r', 'output.result')],
      [edge('t', 'payload', 'c', 'in'), edge('c', 'true', 'm', 'a'), edge('c', 'false', 'm', 'b'), edge('m', 'out', 'r', 'value')],
    )
    const res = await execute(g, testDefs)
    expect(res.states.r!.outputs).toEqual({ title: 'Result', value: { v: 1 } })
  })

  it('a failure skips downstream but lets other branches finish', async () => {
    const g = wf(
      [node('t', 'trigger.manual'), node('bad', 'test.fail'), node('after', 'test.slow'), node('ok', 'test.slow', { ms: 5 })],
      [edge('t', 'payload', 'bad', 'in'), edge('bad', 'out', 'after', 'in'), edge('t', 'payload', 'ok', 'in')],
    )
    const res = await execute(g, testDefs)
    expect(res.status).toBe('error')
    expect(res.states.bad).toMatchObject({ status: 'error', error: 'boom' })
    expect(res.states.after!.status).toBe('skipped')
    expect(res.states.ok!.status).toBe('success')
  })

  it('times out a node that ignores its abort signal', async () => {
    const g = wf([node('t', 'trigger.manual'), node('h', 'test.hang')], [edge('t', 'payload', 'h', 'in')])
    const res = await execute(g, testDefs)
    expect(res.states.h).toMatchObject({ status: 'error', error: 'timed out after 50 ms' })
  })

  it('cancellation stops running nodes and marks the rest cancelled', async () => {
    const ctrl = new AbortController()
    const g = wf(
      [node('t', 'trigger.manual'), node('d', 'logic.delay', { ms: 5000 }), node('after', 'test.slow')],
      [edge('t', 'payload', 'd', 'in'), edge('d', 'out', 'after', 'in')],
    )
    setTimeout(() => ctrl.abort(), 30)
    const res = await execute(g, testDefs, { signal: ctrl.signal })
    expect(res.status).toBe('cancelled')
    expect(res.states.d!.status).toBe('cancelled')
    expect(res.durationMs).toBeLessThan(500)
  })

  it('respects the concurrency limit', async () => {
    let live = 0
    let peak = 0
    const defs: Record<string, NodeDefinition> = {
      ...testDefs,
      'test.count': {
        ...testDefs['test.slow']!, type: 'test.count',
        async run() { live++; peak = Math.max(peak, live); await sleep(20); live--; return { out: 1 } },
      },
    }
    const workers = Array.from({ length: 8 }, (_, i) => node(`w${i}`, 'test.count'))
    const g = wf([node('t', 'trigger.manual'), ...workers], workers.map((w) => edge('t', 'payload', w.id, 'in')))
    await execute(g, defs, { concurrency: 3 })
    expect(peak).toBe(3)
  })

  it('refuses to run a cyclic graph', async () => {
    const g = wf([node('a', 'test.slow'), node('b', 'test.slow')], [edge('a', 'out', 'b', 'in'), edge('b', 'out', 'a', 'in')])
    await expect(execute(g, testDefs)).rejects.toBeInstanceOf(WorkflowError)
  })
})

describe('history', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    const h = new History<number>()
    h.push(1); h.push(2)
    expect(h.undo(3)).toBe(2)
    expect(h.redo(2)).toBe(3)
    h.undo(3)
    h.push(2)
    expect(h.canRedo).toBe(false)
  })

  it('coalesces rapid edits with the same key into one step', () => {
    const h = new History<number>(100, 600)
    h.push(0, 'move:n1', 1000)
    h.push(1, 'move:n1', 1100)
    h.push(2, 'move:n1', 1200)
    expect(h.undo(3)).toBe(0)
    expect(h.canUndo).toBe(false)
  })
})

describe('serialize', () => {
  it('migrates v1 edge format', () => {
    const v1 = {
      name: 'old',
      nodes: [{ id: 'a', type: 'trigger.manual', position: { x: 0, y: 0 } }, { id: 'b', type: 'output.result', position: { x: 1, y: 1 } }],
      edges: [{ source: 'a', target: 'b', sourcePort: 'payload', targetPort: 'value' }],
    }
    const wf2 = migrate(v1)
    expect(wf2.version).toBe(CURRENT_VERSION)
    expect(wf2.edges[0]).toMatchObject({ from: { node: 'a', port: 'payload' }, to: { node: 'b', port: 'value' } })
  })

  it('rejects malformed and future files', () => {
    expect(() => migrate({ version: 99, nodes: [], edges: [] })).toThrow(/newer version/)
    expect(() => migrate({ version: 2, nodes: [{ id: 'a', type: 'x', position: { x: 0, y: 0 } }], edges: [{ id: 'e', from: { node: 'a' }, to: { node: 'zz' } }] }))
      .toThrow(ImportError)
  })
})

describe('compare', () => {
  it('treats numeric strings as numbers', () => {
    expect(compare('200', 'equals', 200)).toBe(true)
    expect(compare('10', 'greater than', '9')).toBe(true)
    expect(compare('abc', 'equals', 'abc')).toBe(true)
    expect(compare([], 'is empty', '')).toBe(true)
  })
})
