/**
 * Import/export with schema versioning.
 *
 * Saved workflows outlive the code that wrote them. Each file carries a
 * version, and loading runs it through every migration in order, so a file
 * from v1 opens in v3 without the editor knowing v1 ever existed. Imports
 * are validated structurally because a workflow file is untrusted input —
 * often pasted from a chat or downloaded from someone else.
 */

import type { Workflow } from './types'

export const CURRENT_VERSION = 2

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>

const migrations: Record<number, Migration> = {
  // v1 stored edges as { source, target, sourcePort, targetPort }.
  1: (doc) => ({
    ...doc,
    version: 2,
    edges: ((doc.edges as Record<string, string>[]) ?? []).map((e, i) => ({
      id: e.id ?? `e${i}`,
      from: { node: e.source, port: e.sourcePort ?? 'out' },
      to: { node: e.target, port: e.targetPort ?? 'in' },
    })),
  }),
}

export class ImportError extends Error {}

export function migrate(raw: unknown): Workflow {
  if (!raw || typeof raw !== 'object') throw new ImportError('not a workflow file')
  let doc = raw as Record<string, unknown>
  let version = typeof doc.version === 'number' ? doc.version : 1
  if (version > CURRENT_VERSION) {
    throw new ImportError(`file is from a newer version (v${version}); this editor supports up to v${CURRENT_VERSION}`)
  }
  while (version < CURRENT_VERSION) {
    const step = migrations[version]
    if (!step) throw new ImportError(`no migration from v${version}`)
    doc = step(doc)
    version = doc.version as number
  }
  return check(doc)
}

function check(doc: Record<string, unknown>): Workflow {
  const nodes = doc.nodes
  const edges = doc.edges
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new ImportError('nodes and edges must be arrays')
  const ids = new Set<string>()
  for (const n of nodes) {
    if (typeof n?.id !== 'string' || typeof n?.type !== 'string') throw new ImportError('every node needs an id and a type')
    if (ids.has(n.id)) throw new ImportError(`duplicate node id "${n.id}"`)
    ids.add(n.id)
    if (typeof n.position?.x !== 'number' || typeof n.position?.y !== 'number') {
      throw new ImportError(`node "${n.id}" has no valid position`)
    }
    if (n.config !== undefined && (typeof n.config !== 'object' || Array.isArray(n.config))) {
      throw new ImportError(`node "${n.id}" config must be an object`)
    }
  }
  for (const e of edges) {
    if (!ids.has(e?.from?.node) || !ids.has(e?.to?.node)) throw new ImportError(`edge "${e?.id}" references a missing node`)
  }
  return {
    version: CURRENT_VERSION,
    name: typeof doc.name === 'string' ? doc.name : 'Imported workflow',
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, position: { x: n.position.x, y: n.position.y }, config: n.config ?? {} })),
    edges: edges.map((e) => ({ id: String(e.id), from: { node: e.from.node, port: String(e.from.port) }, to: { node: e.to.node, port: String(e.to.port) } })),
  }
}

export function exportWorkflow(wf: Workflow): string {
  return JSON.stringify({ ...wf, version: CURRENT_VERSION }, null, 2)
}

let counter = 0
export function uid(prefix: string): string {
  // Time + counter + randomness: unique across tabs and imports without a
  // crypto dependency, and sortable by creation time when debugging.
  return `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
