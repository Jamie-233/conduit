/**
 * Graph analysis: ordering, cycle detection and connection rules.
 *
 * Kahn's algorithm is used rather than DFS because it does two jobs at once:
 * it produces a topological order, and whatever it *fails* to emit is
 * exactly the set of nodes on or downstream of a cycle — which is what the
 * editor needs to highlight. A DFS would report one back-edge and stop.
 */

import type { NodeDefinition, PortType, Workflow, WorkflowEdge } from './types'

export interface Issue {
  severity: 'error' | 'warning'
  message: string
  nodeId?: string
  edgeId?: string
}

export function incoming(wf: Workflow, nodeId: string): WorkflowEdge[] {
  return wf.edges.filter((e) => e.to.node === nodeId)
}

export function outgoing(wf: Workflow, nodeId: string): WorkflowEdge[] {
  return wf.edges.filter((e) => e.from.node === nodeId)
}

export function topoSort(wf: Workflow): { order: string[]; cyclic: string[] } {
  const indegree = new Map(wf.nodes.map((n) => [n.id, 0]))
  const next = new Map<string, string[]>(wf.nodes.map((n) => [n.id, []]))
  for (const e of wf.edges) {
    if (!indegree.has(e.from.node) || !indegree.has(e.to.node)) continue
    indegree.set(e.to.node, (indegree.get(e.to.node) ?? 0) + 1)
    next.get(e.from.node)!.push(e.to.node)
  }
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const m of next.get(id)!) {
      const d = indegree.get(m)! - 1
      indegree.set(m, d)
      if (d === 0) queue.push(m)
    }
  }
  const done = new Set(order)
  return { order, cyclic: wf.nodes.map((n) => n.id).filter((id) => !done.has(id)) }
}

/** Would adding from → to close a loop? Checked before the edge exists. */
export function createsCycle(wf: Workflow, from: string, to: string): boolean {
  if (from === to) return true
  const stack = [to]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of outgoing(wf, id)) stack.push(e.to.node)
  }
  return false
}

export function typesCompatible(out: PortType, input: PortType): boolean {
  return out === 'any' || input === 'any' || out === input
}

export type ConnectCheck = { ok: true } | { ok: false; reason: string }

export function canConnect(
  wf: Workflow,
  defs: Record<string, NodeDefinition>,
  from: { node: string; port: string },
  to: { node: string; port: string },
): ConnectCheck {
  const a = wf.nodes.find((n) => n.id === from.node)
  const b = wf.nodes.find((n) => n.id === to.node)
  if (!a || !b) return { ok: false, reason: 'unknown node' }
  const out = defs[a.type]?.outputs.find((p) => p.name === from.port)
  const inp = defs[b.type]?.inputs.find((p) => p.name === to.port)
  if (!out || !inp) return { ok: false, reason: 'unknown port' }
  if (!typesCompatible(out.type, inp.type)) {
    return { ok: false, reason: `${out.type} output cannot feed a ${inp.type} input` }
  }
  if (createsCycle(wf, a.id, b.id)) return { ok: false, reason: 'this connection would create a loop' }
  return { ok: true }
}

export function validate(wf: Workflow, defs: Record<string, NodeDefinition>): Issue[] {
  const issues: Issue[] = []
  const ids = new Set(wf.nodes.map((n) => n.id))

  for (const n of wf.nodes) {
    const def = defs[n.type]
    if (!def) {
      issues.push({ severity: 'error', nodeId: n.id, message: `unknown node type "${n.type}"` })
      continue
    }
    const into = incoming(wf, n.id)
    for (const port of def.inputs) {
      const count = into.filter((e) => e.to.port === port.name).length
      if (port.required && count === 0) {
        issues.push({ severity: 'error', nodeId: n.id, message: `${def.label}: input "${port.label ?? port.name}" is not connected` })
      }
      if (count > 1) {
        // One value per input keeps data flow unambiguous; fan-in is an
        // explicit Merge node, so nobody has to guess which edge "won".
        issues.push({ severity: 'error', nodeId: n.id, message: `${def.label}: input "${port.name}" has ${count} connections` })
      }
    }
    if (def.inputs.length && into.length === 0 && def.category !== 'Triggers') {
      issues.push({ severity: 'warning', nodeId: n.id, message: `${def.label} is not connected and will be skipped` })
    }
  }

  for (const e of wf.edges) {
    if (!ids.has(e.from.node) || !ids.has(e.to.node)) {
      issues.push({ severity: 'error', edgeId: e.id, message: 'connection points to a deleted node' })
      continue
    }
    const a = wf.nodes.find((n) => n.id === e.from.node)!
    const b = wf.nodes.find((n) => n.id === e.to.node)!
    const out = defs[a.type]?.outputs.find((p) => p.name === e.from.port)
    const inp = defs[b.type]?.inputs.find((p) => p.name === e.to.port)
    if (out && inp && !typesCompatible(out.type, inp.type)) {
      issues.push({ severity: 'error', edgeId: e.id, message: `type mismatch: ${out.type} → ${inp.type}` })
    }
  }

  const { cyclic } = topoSort(wf)
  for (const id of cyclic) {
    issues.push({ severity: 'error', nodeId: id, message: 'part of a loop; workflows must be acyclic' })
  }

  if (!wf.nodes.some((n) => defs[n.type]?.category === 'Triggers')) {
    issues.push({ severity: 'warning', message: 'no trigger node: nothing will start this workflow' })
  }
  return issues
}
