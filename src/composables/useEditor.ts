/**
 * Editor state as a single composable.
 *
 * Every mutation goes through `commit`, which snapshots into history first.
 * Funnelling edits through one function is what makes undo trustworthy: there
 * is no code path that changes the document without recording it.
 */

import { computed, reactive, ref, shallowRef, toRaw } from 'vue'

import { execute, type RunResult } from '@/engine/executor'
import { canConnect, validate } from '@/engine/graph'
import { History } from '@/engine/history'
import { exportWorkflow, migrate, uid } from '@/engine/serialize'
import type { Endpoint, NodeRunState, Point, Workflow } from '@/engine/types'
import { definitions } from '@/nodes'
import { sample } from '@/sample'

const STORAGE_KEY = 'conduit.workflow'

function load(): Workflow {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return migrate(JSON.parse(saved))
  } catch {
    /* corrupt or unavailable storage falls back to the sample */
  }
  return structuredClone(sample)
}

export function useEditor() {
  const doc = ref<Workflow>(load())
  const history = new History<Workflow>()
  const selected = ref<string | null>(null)
  const runStates = reactive<Record<string, NodeRunState>>({})
  const lastRun = shallowRef<RunResult | null>(null)
  const running = ref(false)
  const toast = ref('')
  let controller: AbortController | null = null
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const issues = computed(() => validate(doc.value, definitions))
  const errors = computed(() => issues.value.filter((i) => i.severity === 'error'))
  const selectedNode = computed(() => doc.value.nodes.find((n) => n.id === selected.value) ?? null)
  const revision = ref(0)

  function notify(message: string) {
    toast.value = message
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = ''), 2600)
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, exportWorkflow(toRaw(doc.value)))
    } catch {
      /* private mode: editing still works, it just isn't saved */
    }
  }

  function commit(mutate: (wf: Workflow) => void, key?: string) {
    history.push(toRaw(doc.value), key)
    mutate(doc.value)
    revision.value++
    persist()
  }

  function addNode(type: string, position: Point) {
    const def = definitions[type]
    if (!def) return
    const id = uid('n')
    commit((wf) => {
      wf.nodes.push({ id, type, position, config: Object.fromEntries(def.fields.map((f) => [f.key, structuredClone(f.default)])) })
    })
    selected.value = id
  }

  function moveNode(id: string, position: Point) {
    commit((wf) => {
      const n = wf.nodes.find((x) => x.id === id)
      if (n) n.position = position
    }, `move:${id}`)
  }

  function updateConfig(id: string, key: string, value: unknown) {
    commit((wf) => {
      const n = wf.nodes.find((x) => x.id === id)
      if (n) n.config[key] = value
    }, `config:${id}:${key}`)
  }

  function renameNode(id: string, label: string) {
    commit((wf) => {
      const n = wf.nodes.find((x) => x.id === id)
      if (n) n.label = label || undefined
    }, `label:${id}`)
  }

  function removeNode(id: string) {
    commit((wf) => {
      wf.nodes = wf.nodes.filter((n) => n.id !== id)
      wf.edges = wf.edges.filter((e) => e.from.node !== id && e.to.node !== id)
    })
    if (selected.value === id) selected.value = null
  }

  function connect(from: Endpoint, to: Endpoint): boolean {
    const check = canConnect(doc.value, definitions, from, to)
    if (!check.ok) {
      notify(check.reason)
      return false
    }
    commit((wf) => {
      // Connecting into an occupied input replaces the old edge — the
      // behaviour people expect from patch cables, and it keeps the
      // one-edge-per-input rule without an error dialog.
      wf.edges = wf.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port))
      wf.edges.push({ id: uid('e'), from, to })
    })
    return true
  }

  function removeEdge(id: string) {
    commit((wf) => {
      wf.edges = wf.edges.filter((e) => e.id !== id)
    })
  }

  function undo() {
    const prev = history.undo(toRaw(doc.value))
    if (prev) { doc.value = prev; revision.value++; persist() }
  }

  function redo() {
    const next = history.redo(toRaw(doc.value))
    if (next) { doc.value = next; revision.value++; persist() }
  }

  async function run() {
    if (running.value) return
    if (errors.value.length) {
      notify(`Fix ${errors.value.length} problem(s) before running`)
      return
    }
    for (const k of Object.keys(runStates)) delete runStates[k]
    running.value = true
    controller = new AbortController()
    try {
      lastRun.value = await execute(structuredClone(toRaw(doc.value)), definitions, {
        signal: controller.signal,
        onUpdate: (id, s) => { runStates[id] = s },
      })
      const r = lastRun.value
      notify(r.status === 'success' ? `Run finished in ${r.durationMs} ms` : `Run ${r.status}`)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err))
    } finally {
      running.value = false
      controller = null
    }
  }

  function cancel() {
    controller?.abort(new Error('cancelled by user'))
  }

  function exportFile() {
    const blob = new Blob([exportWorkflow(toRaw(doc.value))], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${doc.value.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'workflow'}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importFile(file: File) {
    try {
      const next = migrate(JSON.parse(await file.text()))
      commit((wf) => Object.assign(wf, next))
      selected.value = null
      notify(`Imported “${next.name}”`)
    } catch (err) {
      notify(`Import failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  function reset() {
    commit((wf) => Object.assign(wf, structuredClone(sample)))
    selected.value = null
  }

  return {
    doc, selected, selectedNode, issues, errors, runStates, lastRun, running, toast, revision,
    addNode, moveNode, updateConfig, renameNode, removeNode, connect, removeEdge,
    undo, redo, run, cancel, exportFile, importFile, reset, notify,
    canUndo: () => history.canUndo, canRedo: () => history.canRedo,
  }
}

export type Editor = ReturnType<typeof useEditor>
