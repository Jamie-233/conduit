<script setup lang="ts">
import { computed } from 'vue'

import type { NodeDefinition, NodeRunState, WorkflowNode } from '@/engine/types'
import { CATEGORY_COLOR, HEADER, NODE_WIDTH, PAD, ROW } from '@/layout'

const props = defineProps<{
  node: WorkflowNode
  def: NodeDefinition
  selected: boolean
  run?: NodeRunState
  hasIssue: boolean
}>()

const emit = defineEmits<{
  (e: 'drag-start', ev: PointerEvent): void
  (e: 'port-down', ev: PointerEvent, port: string): void
}>()

const rows = computed(() => Math.max(props.def.inputs.length, props.def.outputs.length, 1))
const duration = computed(() => {
  const r = props.run
  return r?.startedAt && r.finishedAt ? `${r.finishedAt - r.startedAt} ms` : ''
})
</script>

<template>
  <div
    class="node"
    :class="[run?.status ?? 'idle', { selected, issue: hasIssue }]"
    :style="{
      transform: `translate(${node.position.x}px, ${node.position.y}px)`,
      width: `${NODE_WIDTH}px`,
      '--accent': CATEGORY_COLOR[def.category],
    }"
    :data-node="node.id"
  >
    <header :style="{ height: `${HEADER}px` }" @pointerdown.stop="emit('drag-start', $event)">
      <span class="dot" />
      <span class="title">{{ node.label || def.label }}</span>
      <span class="status" :title="run?.error">{{ run && run.status !== 'idle' && run.status !== 'queued' ? (duration || run.status) : '' }}</span>
    </header>
    <div class="ports" :style="{ padding: `${PAD}px 0`, height: `${rows * ROW + PAD * 2}px` }">
      <div class="col in">
        <div v-for="p in def.inputs" :key="p.name" class="port" :style="{ height: `${ROW}px` }">
          <span class="jack" :data-port-in="p.name" :data-node="node.id" :data-type="p.type" />
          <span class="label">{{ p.label ?? p.name }}<i v-if="p.required">*</i></span>
        </div>
      </div>
      <div class="col out">
        <div v-for="p in def.outputs" :key="p.name" class="port" :style="{ height: `${ROW}px` }">
          <span class="label">{{ p.label ?? p.name }}</span>
          <span class="jack" :data-type="p.type" @pointerdown.stop="emit('port-down', $event, p.name)" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node {
  position: absolute; top: 0; left: 0;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 1px 0 rgb(0 0 0 / .2), 0 8px 24px -12px rgb(0 0 0 / .5);
  user-select: none; transition: border-color .15s, box-shadow .15s;
}
.node.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 8px 24px -10px rgb(0 0 0 / .6); }
.node.issue:not(.selected) { border-color: color-mix(in srgb, var(--err) 60%, var(--line)); }
.node.running { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent); }
.node.success header .status { color: var(--ok); }
.node.error { border-color: var(--err); }
.node.error header .status { color: var(--err); }
.node.skipped, .node.cancelled { opacity: .45; }

header {
  display: flex; align-items: center; gap: 8px; padding: 0 12px; cursor: grab;
  border-bottom: 1px solid var(--line); border-radius: 10px 10px 0 0;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%);
}
header:active { cursor: grabbing; }
.dot { width: 8px; height: 8px; border-radius: 2px; background: var(--accent); flex: none; }
.node.running .dot { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .3; } }
.title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.status { font: 11px var(--mono); color: var(--muted); }

.ports { display: flex; justify-content: space-between; box-sizing: border-box; }
.col { display: flex; flex-direction: column; }
.port { display: flex; align-items: center; gap: 8px; font: 11px var(--mono); color: var(--muted); }
.col.out .port { justify-content: flex-end; }
.label i { color: var(--err); font-style: normal; margin-left: 1px; }
.jack {
  width: 12px; height: 12px; border-radius: 50%; background: var(--bg);
  border: 2px solid var(--accent); box-sizing: border-box; flex: none; cursor: crosshair;
}
.col.in .jack { margin-left: -7px; }
.col.out .jack { margin-right: -7px; }
.jack:hover { background: var(--accent); }
.jack[data-type='array'] { border-radius: 3px; }
.jack[data-type='object'] { border-radius: 3px; transform: rotate(45deg) scale(.9); }
</style>
