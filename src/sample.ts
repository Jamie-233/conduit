import { CURRENT_VERSION } from '@/engine/serialize'
import type { Workflow } from '@/engine/types'

/**
 * The first thing a new user sees, so it demonstrates the three ideas that
 * matter: parallel branches (DNS and HTTP run together), branching on a
 * condition, and error routing via the HTTP node's "failed" port.
 */
export const sample: Workflow = {
  version: CURRENT_VERSION,
  name: 'Website health check',
  nodes: [
    { id: 'trigger', type: 'trigger.manual', position: { x: 0, y: 190 },
      config: { payload: { host: 'api.github.com', url: 'https://api.github.com/zen' } } },
    { id: 'dns', type: 'net.dns', position: { x: 270, y: 40 },
      config: { name: '{{ input.trigger.host }}', type: 'A', resolver: 'cloudflare' } },
    { id: 'http', type: 'net.http', position: { x: 270, y: 250 },
      config: { method: 'GET', url: '{{ input.trigger.url }}', headers: {} } },
    { id: 'fast', type: 'logic.condition', label: 'Under 800 ms?', position: { x: 540, y: 210 },
      config: { left: '{{ in.ms }}', operator: 'less than', right: '800' } },
    { id: 'dns-out', type: 'output.result', position: { x: 540, y: 20 }, config: { title: 'DNS records' } },
    { id: 'healthy', type: 'data.template', position: { x: 810, y: 140 },
      config: { template: '✅ Healthy: HTTP {{ in.status }} in {{ in.ms }} ms' } },
    { id: 'slow', type: 'data.template', position: { x: 810, y: 290 },
      config: { template: '⚠️ Slow: {{ in.ms }} ms' } },
    { id: 'down', type: 'data.template', position: { x: 540, y: 410 },
      config: { template: '❌ Down: HTTP {{ in.status }}' } },
    { id: 'merge', type: 'logic.merge', position: { x: 1080, y: 250 }, config: { mode: 'first' } },
    { id: 'report', type: 'output.result', position: { x: 1340, y: 250 }, config: { title: 'Status' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'trigger', port: 'payload' }, to: { node: 'dns', port: 'trigger' } },
    { id: 'e2', from: { node: 'trigger', port: 'payload' }, to: { node: 'http', port: 'trigger' } },
    { id: 'e3', from: { node: 'dns', port: 'records' }, to: { node: 'dns-out', port: 'value' } },
    { id: 'e4', from: { node: 'http', port: 'ok' }, to: { node: 'fast', port: 'in' } },
    { id: 'e5', from: { node: 'fast', port: 'true' }, to: { node: 'healthy', port: 'in' } },
    { id: 'e6', from: { node: 'fast', port: 'false' }, to: { node: 'slow', port: 'in' } },
    { id: 'e7', from: { node: 'http', port: 'failed' }, to: { node: 'down', port: 'in' } },
    { id: 'e8', from: { node: 'healthy', port: 'text' }, to: { node: 'merge', port: 'a' } },
    { id: 'e9', from: { node: 'slow', port: 'text' }, to: { node: 'merge', port: 'b' } },
    { id: 'e10', from: { node: 'down', port: 'text' }, to: { node: 'merge', port: 'c' } },
    { id: 'e11', from: { node: 'merge', port: 'out' }, to: { node: 'report', port: 'value' } },
  ],
}
