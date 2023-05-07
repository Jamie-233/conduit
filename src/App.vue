<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import FlowCanvas from '@/components/FlowCanvas.vue'
import NodeInspector from '@/components/NodeInspector.vue'
import NodePalette from '@/components/NodePalette.vue'
import { useEditor } from '@/composables/useEditor'

const ed = useEditor()
const canvas = ref<InstanceType<typeof FlowCanvas>>()
const fileInput = ref<HTMLInputElement>()

const summary = computed(() => {
  const r = ed.lastRun.value
  if (ed.running.value) return 'Running…'
  if (!r) return ''
  const counts: Record<string, number> = {}
  for (const s of Object.values(r.states)) counts[s.status] = (counts[s.status] ?? 0) + 1
  return `${r.status} · ${r.durationMs} ms · ` + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')
})

function addFromPalette(type: string) {
  const n = ed.doc.value.nodes.length
  ed.addNode(type, { x: 120 + (n % 5) * 40, y: 120 + (n % 5) * 40 })
}

function onKey(ev: KeyboardEvent) {
  const t = ev.target as HTMLElement
  if (t.closest('input, textarea, select, [contenteditable]')) return
  const mod = ev.metaKey || ev.ctrlKey
  if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? ed.redo() : ed.undo() }
  else if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); ed.redo() }
  else if (mod && ev.key === 'Enter') { ev.preventDefault(); void ed.run() }
  else if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); ed.exportFile() }
  else if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (canvas.value?.deleteSelectedEdge()) return
    if (ed.selected.value) ed.removeNode(ed.selected.value)
  } else if (ev.key === 'Escape') ed.selected.value = null
  else if (ev.key === 'f' && !mod) canvas.value?.fit()
}

function onFile(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (f) void ed.importFile(f)
  ;(ev.target as HTMLInputElement).value = ''
}

onMounted(() => { window.addEventListener('keydown', onKey); requestAnimationFrame(() => canvas.value?.fit()) })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="app">
    <header class="bar">
      <div class="brand"><span class="logo">◆</span> Conduit</div>
      <input v-model="ed.doc.value.name" class="wf-name" aria-label="Workflow name" />
      <div class="spacer" />
      <span class="problems" :class="{ bad: ed.errors.value.length }" :title="ed.issues.value.map((i) => i.message).join('\n')">
        {{ ed.errors.value.length ? `${ed.errors.value.length} problem${ed.errors.value.length > 1 ? 's' : ''}` : 'Valid' }}
      </span>
      <button class="ghost" :disabled="!ed.canUndo()" title="Undo (⌘Z)" @click="ed.undo()">Undo</button>
      <button class="ghost" :disabled="!ed.canRedo()" title="Redo (⇧⌘Z)" @click="ed.redo()">Redo</button>
      <button class="ghost" title="Fit to screen (F)" @click="canvas?.fit()">Fit</button>
      <button class="ghost" title="Import JSON" @click="fileInput?.click()">Import</button>
      <button class="ghost" title="Export JSON (⌘S)" @click="ed.exportFile()">Export</button>
      <button v-if="ed.running.value" class="primary stop" @click="ed.cancel()">Stop</button>
      <button v-else class="primary" title="Run (⌘↵)" @click="ed.run()">Run ▸</button>
      <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onFile" />
    </header>

    <NodePalette class="left" @add="addFromPalette" />
    <main class="stage">
      <FlowCanvas ref="canvas" :editor="ed" />
      <div v-if="summary" class="runbar" :class="ed.lastRun.value?.status">{{ summary }}</div>
      <transition name="fade"><div v-if="ed.toast.value" class="toast">{{ ed.toast.value }}</div></transition>
    </main>
    <NodeInspector class="right" :editor="ed" />
  </div>
</template>

<style>
:root {
  --bg: #0e1013; --panel: #171a1f; --line: #262b33; --text: #e4e7eb; --muted: #8a93a0; --hover: #1e2229;
  --grid: #2a2f37; --wire: #4a5260; --focus: #7aa7ff; --ok: #42d392; --err: #ff6b6b; --warn: #f5b74f;
  --c-trigger: #f5b74f; --c-network: #5ab0ff; --c-data: #b48cff; --c-logic: #42d392; --c-output: #ff8fa3;
  --mono: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f4f5f7; --panel: #ffffff; --line: #dfe2e7; --text: #16191d; --muted: #646d78; --hover: #eef0f3;
    --grid: #d3d7dd; --wire: #9aa3ae; --focus: #2f6bff; --ok: #12a160; --err: #d93a3a; --warn: #b7791f;
    --c-trigger: #d99a1e; --c-network: #2a86e0; --c-data: #8a5cf6; --c-logic: #12a160; --c-output: #e0516e;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.4 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
button { font: inherit; }
</style>

<style scoped>
.app {
  height: 100%; display: grid;
  grid-template: 'bar bar bar' 52px 'left stage right' 1fr / 220px 1fr 320px;
}
.bar { grid-area: bar; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
.brand { font-weight: 700; letter-spacing: .02em; display: flex; align-items: center; gap: 8px; margin-right: 8px; }
.logo { color: var(--focus); }
.wf-name { background: none; border: 1px solid transparent; color: var(--text); font: inherit; padding: 5px 8px; border-radius: 6px; min-width: 0; width: 260px; }
.wf-name:hover, .wf-name:focus { border-color: var(--line); outline: none; }
.spacer { flex: 1; }
.problems { font: 12px var(--mono); color: var(--ok); margin-right: 6px; }
.problems.bad { color: var(--err); }
.ghost, .primary { border-radius: 8px; padding: 6px 12px; cursor: pointer; border: 1px solid var(--line); }
.ghost { background: none; color: var(--text); }
.ghost:hover:not(:disabled) { background: var(--hover); }
.ghost:disabled { opacity: .4; cursor: default; }
.primary { background: var(--focus); border-color: var(--focus); color: #fff; font-weight: 600; min-width: 74px; }
.primary.stop { background: var(--err); border-color: var(--err); }
.left { grid-area: left; border-right: 1px solid var(--line); background: var(--panel); }
.right { grid-area: right; border-left: 1px solid var(--line); background: var(--panel); }
.stage { grid-area: stage; position: relative; min-width: 0; }
.runbar {
  position: absolute; left: 12px; bottom: 12px; padding: 6px 10px; border-radius: 8px; font: 12px var(--mono);
  background: var(--panel); border: 1px solid var(--line); color: var(--muted);
}
.runbar.success { color: var(--ok); } .runbar.error { color: var(--err); }
.toast {
  position: absolute; left: 50%; top: 14px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px;
  background: var(--text); color: var(--bg); font-size: 13px; box-shadow: 0 8px 24px rgb(0 0 0 / .3);
}
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 900px) {
  .app { grid-template: 'bar' 52px 'stage' 1fr 'right' 40vh / 1fr; }
  .left { display: none; }
  .right { border-left: 0; border-top: 1px solid var(--line); }
  .wf-name { width: 140px; }
  .bar .ghost:not(:disabled) { padding: 6px 8px; }
}
</style>
