<script setup lang="ts">
/**
 * Infinite canvas with pan, zoom, node dragging and wiring.
 *
 * All interaction is built on Pointer Events with pointer capture, so mouse,
 * pen and touch share one code path and a drag keeps tracking even when the
 * cursor leaves the element. Screen coordinates are converted to world
 * coordinates in exactly one place (`toWorld`), which is where pan/zoom bugs
 * usually hide when the conversion is scattered across handlers.
 */
import { computed, reactive, ref } from 'vue'

import type { Point } from '@/engine/types'
import type { Editor } from '@/composables/useEditor'
import { portPoint, wire } from '@/layout'
import { definitions } from '@/nodes'
import NodeCard from './NodeCard.vue'

const props = defineProps<{ editor: Editor }>()
const ed = props.editor

const root = ref<HTMLDivElement>()
const view = reactive({ x: 40, y: 40, k: 0.85 })
const pending = ref<{ from: { node: string; port: string }; a: Point; b: Point } | null>(null)
const selectedEdge = ref<string | null>(null)

const issueNodes = computed(() => new Set(ed.issues.value.map((i) => i.nodeId).filter(Boolean)))

function toWorld(clientX: number, clientY: number): Point {
  const r = root.value!.getBoundingClientRect()
  return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k }
}

const edges = computed(() =>
  ed.doc.value.nodes.length === 0 ? [] : ed.doc.value.edges.flatMap((e) => {
    const a = ed.doc.value.nodes.find((n) => n.id === e.from.node)
    const b = ed.doc.value.nodes.find((n) => n.id === e.to.node)
    const da = a && definitions[a.type]
    const db = b && definitions[b.type]
    if (!a || !b || !da || !db) return []
    const state = ed.runStates[a.id]
    // A wire is "live" when its source succeeded *and* emitted this port —
    // which is how the canvas shows which branch of a condition fired.
    const live = state?.status === 'success' && state.outputs && e.from.port in state.outputs
    return [{ id: e.id, d: wire(portPoint(a, da, 'out', e.from.port), portPoint(b, db, 'in', e.to.port)), live }]
  }),
)

function startPan(ev: PointerEvent) {
  if (ev.button !== 0 && ev.button !== 1) return
  ed.selected.value = null
  selectedEdge.value = null
  const start = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y }
  const el = ev.currentTarget as HTMLElement
  el.setPointerCapture(ev.pointerId)
  const move = (e: PointerEvent) => {
    view.x = start.vx + e.clientX - start.x
    view.y = start.vy + e.clientY - start.y
  }
  const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

function onWheel(ev: WheelEvent) {
  ev.preventDefault()
  // Trackpads send small, often two-axis deltas and report pinch as
  // ctrlKey+wheel; mouse wheels send large single-axis steps. Pan for the
  // former and zoom for pinch and mouse wheel — what design tools do.
  const pinch = ev.ctrlKey || ev.metaKey
  const mouseWheel = ev.deltaMode !== 0 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 50)
  if (!pinch && !mouseWheel) {
    view.x -= ev.deltaX
    view.y -= ev.deltaY
    return
  }
  const before = toWorld(ev.clientX, ev.clientY)
  const step = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY
  view.k = Math.min(2, Math.max(0.25, view.k * Math.exp(-step * (pinch ? 0.01 : 0.0015))))
  // Keep the world point under the cursor fixed while zooming.
  const r = root.value!.getBoundingClientRect()
  view.x = ev.clientX - r.left - before.x * view.k
  view.y = ev.clientY - r.top - before.y * view.k
}

function dragNode(id: string, ev: PointerEvent) {
  ed.selected.value = id
  selectedEdge.value = null
  const node = ed.doc.value.nodes.find((n) => n.id === id)
  if (!node) return
  const startWorld = toWorld(ev.clientX, ev.clientY)
  const origin = { ...node.position }
  const el = ev.currentTarget as HTMLElement
  el.setPointerCapture(ev.pointerId)
  const move = (e: PointerEvent) => {
    const p = toWorld(e.clientX, e.clientY)
    // Snap to an 8 px grid so hand-placed nodes line up without effort.
    const snap = (v: number) => (e.altKey ? v : Math.round(v / 8) * 8)
    ed.moveNode(id, { x: snap(origin.x + p.x - startWorld.x), y: snap(origin.y + p.y - startWorld.y) })
  }
  const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

function startWire(nodeId: string, port: string, ev: PointerEvent) {
  const node = ed.doc.value.nodes.find((n) => n.id === nodeId)!
  const a = portPoint(node, definitions[node.type]!, 'out', port)
  pending.value = { from: { node: nodeId, port }, a, b: a }
  const el = ev.currentTarget as HTMLElement
  el.setPointerCapture(ev.pointerId)
  const move = (e: PointerEvent) => { if (pending.value) pending.value.b = toWorld(e.clientX, e.clientY) }
  const up = (e: PointerEvent) => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    // Pointer capture retargets events to the source jack, so the drop
    // target has to be found by hit-testing the release point.
    el.releasePointerCapture(e.pointerId)
    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const port = target?.dataset.portIn
    const to = target?.dataset.node
    if (pending.value && port && to) ed.connect(pending.value.from, { node: to, port })
    pending.value = null
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

function onDrop(ev: DragEvent) {
  const type = ev.dataTransfer?.getData('application/x-conduit-node')
  if (type) ed.addNode(type, toWorld(ev.clientX - 110, ev.clientY - 20))
}

function deleteSelectedEdge(): boolean {
  if (!selectedEdge.value) return false
  ed.removeEdge(selectedEdge.value)
  selectedEdge.value = null
  return true
}

function fit() {
  const nodes = ed.doc.value.nodes
  if (!nodes.length || !root.value) return
  const r = root.value.getBoundingClientRect()
  const xs = nodes.map((n) => n.position.x)
  const ys = nodes.map((n) => n.position.y)
  const w = Math.max(...xs) - Math.min(...xs) + 260
  const h = Math.max(...ys) - Math.min(...ys) + 200
  // Never fit below a readable zoom; a large graph scrolls instead of shrinking to dots.
  view.k = Math.min(1.2, Math.max(0.6, Math.min(r.width / w, r.height / h) * 0.92))
  view.x = Math.max(24, (r.width - w * view.k) / 2) - Math.min(...xs) * view.k
  view.y = (r.height - h * view.k) / 2 - Math.min(...ys) * view.k
}

defineExpose({ deleteSelectedEdge, fit, zoom: (f: number) => (view.k = Math.min(2, Math.max(0.25, view.k * f))) })
</script>

<template>
  <div
    ref="root"
    class="canvas"
    :style="{ '--k': view.k, backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }"
    @pointerdown="startPan"
    @wheel="onWheel"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div class="world" :style="{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }">
      <svg class="wires">
        <g v-for="e in edges" :key="e.id">
          <path class="hit" :d="e.d" @pointerdown.stop="selectedEdge = e.id; ed.selected.value = null" @dblclick="ed.removeEdge(e.id)" />
          <path class="wire" :class="{ live: e.live, selected: selectedEdge === e.id }" :d="e.d" />
        </g>
        <path v-if="pending" class="wire pending" :d="wire(pending.a, pending.b)" />
      </svg>
      <NodeCard
        v-for="n in ed.doc.value.nodes"
        :key="n.id"
        :node="n"
        :def="definitions[n.type]!"
        :selected="ed.selected.value === n.id"
        :run="ed.runStates[n.id]"
        :has-issue="issueNodes.has(n.id)"
        @drag-start="dragNode(n.id, $event)"
        @port-down="(ev, port) => startWire(n.id, port, ev)"
      />
    </div>
    <div v-if="!ed.doc.value.nodes.length" class="empty">Drag a node from the left to start</div>
  </div>
</template>

<style scoped>
.canvas {
  position: relative; overflow: hidden; height: 100%; cursor: default; touch-action: none;
  background-color: var(--bg);
  background-image: radial-gradient(circle, var(--grid) 1px, transparent 1.2px);
}
.world { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.wires { position: absolute; overflow: visible; width: 1px; height: 1px; pointer-events: none; }
.wire { fill: none; stroke: var(--wire); stroke-width: 2; transition: stroke .2s; }
.wire.live { stroke: var(--ok); stroke-width: 2.5; }
.wire.selected { stroke: var(--focus); stroke-width: 3; }
.wire.pending { stroke: var(--focus); stroke-dasharray: 6 5; }
.hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; cursor: pointer; }
.empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); pointer-events: none; }
</style>
