/**
 * Workflow executor.
 *
 * Scheduling is dependency-counting, not level-by-level. A level-based runner
 * waits for the slowest node in a level before starting the next, so one slow
 * HTTP call holds back unrelated branches. Here a node starts the moment its
 * last upstream edge resolves, which gives maximal parallelism for any DAG.
 *
 * Branching uses skip propagation. An edge "resolves" either with a value or
 * as skipped (its source didn't emit that port, or was itself skipped or
 * failed). A node runs if at least one input carries a value; if every
 * input was skipped, it is skipped too, and the skip flows downstream. This
 * gives if/else without loops or a special control-flow node type, and a
 * Merge node after both branches naturally runs once with whichever fired.
 */

import { incoming, outgoing, topoSort } from './graph'
import { renderConfig } from './template'
import type { NodeDefinition, NodeResult, NodeRunState, Workflow } from './types'

export interface RunOptions {
  signal?: AbortSignal
  /** Upper bound on nodes running at once; protects rate-limited APIs. */
  concurrency?: number
  onUpdate?: (nodeId: string, state: NodeRunState) => void
}

export interface RunResult {
  status: 'success' | 'error' | 'cancelled'
  states: Record<string, NodeRunState>
  durationMs: number
}

const SKIP = Symbol('skip')
type EdgeValue = unknown | typeof SKIP

export class WorkflowError extends Error {}

export async function execute(
  wf: Workflow,
  defs: Record<string, NodeDefinition>,
  opts: RunOptions = {},
): Promise<RunResult> {
  const { cyclic } = topoSort(wf)
  if (cyclic.length) throw new WorkflowError('workflow contains a loop')

  const started = performance.now()
  const limit = Math.max(1, opts.concurrency ?? 6)
  const states: Record<string, NodeRunState> = {}
  const edgeValues = new Map<string, EdgeValue>()
  const pending = new Map<string, number>()
  const ready: string[] = []
  let running = 0
  let failed = false

  const update = (id: string, patch: Partial<NodeRunState>) => {
    states[id] = { ...states[id]!, ...patch }
    opts.onUpdate?.(id, states[id]!)
  }

  for (const n of wf.nodes) {
    states[n.id] = { status: 'idle', logs: [] }
    const deps = incoming(wf, n.id).length
    pending.set(n.id, deps)
    if (deps === 0) ready.push(n.id)
  }

  return new Promise<RunResult>((resolve) => {
    let done = false
    const finish = () => {
      // Skipped nodes settle synchronously and re-enter pump(), so the
      // "nothing running, nothing ready" condition can be observed twice.
      if (done) return
      done = true
      const cancelled = opts.signal?.aborted
      resolve({
        status: cancelled ? 'cancelled' : failed ? 'error' : 'success',
        states,
        durationMs: Math.round(performance.now() - started),
      })
    }

    const settle = (id: string, outputs: NodeResult | typeof SKIP) => {
      for (const e of outgoing(wf, id)) {
        const value = outputs === SKIP || !(e.from.port in outputs) ? SKIP : outputs[e.from.port]
        edgeValues.set(e.id, value)
        const left = pending.get(e.to.node)! - 1
        pending.set(e.to.node, left)
        if (left === 0) ready.push(e.to.node)
      }
    }

    const pump = () => {
      while (ready.length && running < limit) {
        const id = ready.shift()!
        void runNode(id)
      }
      if (running === 0 && ready.length === 0) finish()
    }

    const runNode = async (id: string) => {
      const node = wf.nodes.find((n) => n.id === id)!
      const def = defs[node.type]
      const edges = incoming(wf, id)

      if (opts.signal?.aborted) {
        update(id, { status: 'cancelled' })
        settle(id, SKIP)
        return pump()
      }

      const inputs: Record<string, unknown> = {}
      let live = edges.length === 0
      for (const e of edges) {
        const v = edgeValues.get(e.id)
        if (v !== SKIP) {
          inputs[e.to.port] = v
          live = true
        }
      }
      const missingRequired = def?.inputs.some((p) => p.required && !(p.name in inputs))
      if (!def || !live || missingRequired) {
        update(id, { status: 'skipped', inputs })
        settle(id, SKIP)
        return pump()
      }

      running++
      const controller = new AbortController()
      const onAbort = () => controller.abort(opts.signal?.reason)
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      const timer = def.timeoutMs ? setTimeout(() => controller.abort(new Error(`timed out after ${def.timeoutMs} ms`)), def.timeoutMs) : undefined
      const logs: string[] = []
      update(id, { status: 'running', startedAt: Date.now(), inputs, logs })

      try {
        const config = renderConfig({ ...defaultsOf(def), ...node.config }, { input: inputs, ...inputs })
        // Racing against the abort signal means a node that ignores its
        // signal still can't hold the run open after cancel or timeout.
        const outputs = await Promise.race([
          def.run({ inputs, config, signal: controller.signal, log: (m) => logs.push(m) }),
          new Promise<never>((_, reject) => {
            const fail = () => reject(controller.signal.reason ?? new Error('aborted'))
            if (controller.signal.aborted) fail()
            else controller.signal.addEventListener('abort', fail, { once: true })
          }),
        ])
        update(id, { status: 'success', outputs, finishedAt: Date.now(), logs })
        settle(id, outputs)
      } catch (err) {
        const cancelled = opts.signal?.aborted
        if (!cancelled) failed = true
        update(id, {
          status: cancelled ? 'cancelled' : 'error',
          error: err instanceof Error ? err.message : String(err),
          finishedAt: Date.now(),
          logs,
        })
        settle(id, SKIP)
      } finally {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        running--
        pump()
      }
    }

    for (const n of wf.nodes) update(n.id, { status: 'queued' })
    pump()
  })
}

function defaultsOf(def: NodeDefinition): Record<string, unknown> {
  return Object.fromEntries(def.fields.map((f) => [f.key, f.default]))
}
