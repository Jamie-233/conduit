<script setup lang="ts">
import { computed, ref } from 'vue'

import type { NodeDefinition } from '@/engine/types'
import { CATEGORY_COLOR } from '@/layout'
import { nodes } from '@/nodes'

const emit = defineEmits<{ (e: 'add', type: string): void }>()
const query = ref('')

const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  const match = (n: NodeDefinition) => !q || `${n.label} ${n.description} ${n.category}`.toLowerCase().includes(q)
  const out = new Map<string, NodeDefinition[]>()
  for (const n of nodes.filter(match)) out.set(n.category, [...(out.get(n.category) ?? []), n])
  return [...out]
})

function onDragStart(ev: DragEvent, type: string) {
  ev.dataTransfer?.setData('application/x-conduit-node', type)
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="palette">
    <input v-model="query" type="search" placeholder="Search nodes" aria-label="Search nodes" />
    <section v-for="[cat, list] in groups" :key="cat">
      <h3>{{ cat }}</h3>
      <button
        v-for="n in list"
        :key="n.type"
        class="item"
        draggable="true"
        :style="{ '--accent': CATEGORY_COLOR[n.category] }"
        :title="n.description"
        @dragstart="onDragStart($event, n.type)"
        @click="emit('add', n.type)"
      >
        <span class="dot" />
        <span>{{ n.label }}</span>
      </button>
    </section>
    <p v-if="!groups.length" class="none">No nodes match “{{ query }}”</p>
    <p class="hint">Drag onto the canvas, or click to add.</p>
  </aside>
</template>

<style scoped>
.palette { padding: 12px; display: flex; flex-direction: column; gap: 14px; overflow: auto; }
input {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit;
}
h3 { margin: 0 0 6px; font: 600 10px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; margin-bottom: 4px;
  border: 1px solid transparent; border-radius: 8px; background: none; color: var(--text);
  font: inherit; font-size: 13px; text-align: left; cursor: grab;
}
.item:hover { background: var(--hover); border-color: var(--line); }
.dot { width: 8px; height: 8px; border-radius: 2px; background: var(--accent); flex: none; }
.none, .hint { color: var(--muted); font-size: 12px; margin: 0; }
.hint { margin-top: auto; }
</style>
