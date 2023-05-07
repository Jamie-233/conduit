<script setup lang="ts">
/**
 * Config form generated from the node's field schema.
 *
 * JSON fields keep a local draft and only commit when the text parses.
 * Committing on every keystroke would write half-typed, invalid JSON into
 * the document — and into undo history — on the way to a valid value.
 */
import { computed, reactive, watch } from 'vue'

import type { Editor } from '@/composables/useEditor'
import type { FieldSpec } from '@/engine/types'
import { definitions } from '@/nodes'

const props = defineProps<{ editor: Editor }>()
const ed = props.editor

const node = computed(() => ed.selectedNode.value)
const def = computed(() => (node.value ? definitions[node.value.type] : undefined))
const issues = computed(() => ed.issues.value.filter((i) => i.nodeId && i.nodeId === node.value?.id))
const run = computed(() => (node.value ? ed.runStates[node.value.id] : undefined))
const drafts = reactive<Record<string, { text: string; error: string }>>({})

watch(() => node.value?.id, () => {
  for (const k of Object.keys(drafts)) delete drafts[k]
  for (const f of def.value?.fields ?? []) {
    if (f.kind === 'json') drafts[f.key] = { text: JSON.stringify(node.value!.config[f.key] ?? f.default, null, 2), error: '' }
  }
}, { immediate: true })

function value(f: FieldSpec) {
  return node.value?.config[f.key] ?? f.default
}

function set(f: FieldSpec, v: unknown) {
  if (node.value) ed.updateConfig(node.value.id, f.key, v)
}

function setJson(f: FieldSpec, text: string) {
  const d = drafts[f.key]!
  d.text = text
  try {
    set(f, JSON.parse(text))
    d.error = ''
  } catch (err) {
    d.error = err instanceof Error ? err.message.replace(/^JSON\.parse: /, '') : 'invalid JSON'
  }
}

function pretty(v: unknown) {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
}
</script>

<template>
  <aside class="inspector">
    <template v-if="node && def">
      <div class="head">
        <input class="name" :value="node.label ?? ''" :placeholder="def.label" aria-label="Node name"
               @input="ed.renameNode(node.id, ($event.target as HTMLInputElement).value)" />
        <button class="ghost danger" title="Delete node (Del)" @click="ed.removeNode(node.id)">Delete</button>
      </div>
      <p class="desc">{{ def.description }}</p>

      <ul v-if="issues.length" class="issues">
        <li v-for="(i, idx) in issues" :key="idx" :class="i.severity">{{ i.message }}</li>
      </ul>

      <label v-for="f in def.fields" :key="f.key" class="field">
        <span>{{ f.label }}</span>
        <select v-if="f.kind === 'select'" :value="value(f)" @change="set(f, ($event.target as HTMLSelectElement).value)">
          <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
        </select>
        <input v-else-if="f.kind === 'number'" type="number" :min="f.min" :max="f.max" :value="value(f)"
               @input="set(f, Number(($event.target as HTMLInputElement).value))" />
        <input v-else-if="f.kind === 'boolean'" type="checkbox" :checked="Boolean(value(f))"
               @change="set(f, ($event.target as HTMLInputElement).checked)" />
        <textarea v-else-if="f.kind === 'json'" class="code" rows="5" spellcheck="false" :value="drafts[f.key]?.text"
                  @input="setJson(f, ($event.target as HTMLTextAreaElement).value)" />
        <textarea v-else-if="f.kind === 'textarea'" rows="3" :value="String(value(f))"
                  @input="set(f, ($event.target as HTMLTextAreaElement).value)" />
        <input v-else type="text" spellcheck="false" :value="String(value(f))" :placeholder="'placeholder' in f ? f.placeholder : ''"
               @input="set(f, ($event.target as HTMLInputElement).value)" />
        <small v-if="f.kind === 'json' && drafts[f.key]?.error" class="err">{{ drafts[f.key]!.error }}</small>
        <small v-else-if="f.help">{{ f.help }}</small>
      </label>

      <section v-if="run && run.status !== 'idle' && run.status !== 'queued'" class="run">
        <h4>Last run · <span :class="run.status">{{ run.status }}</span></h4>
        <p v-if="run.error" class="err">{{ run.error }}</p>
        <div v-for="(line, i) in run.logs" :key="i" class="log">{{ line }}</div>
        <details v-if="run.inputs && Object.keys(run.inputs).length">
          <summary>Input</summary><pre>{{ pretty(run.inputs) }}</pre>
        </details>
        <details v-if="run.outputs" open>
          <summary>Output</summary><pre>{{ pretty(run.outputs) }}</pre>
        </details>
      </section>
    </template>
    <div v-else class="none">
      <p>Select a node to edit it.</p>
      <p class="tip">Use <code>{{ '{' + '{ input.port.field }' + '}' }}</code> in text fields to pull values from upstream nodes.</p>
    </div>
  </aside>
</template>

<style scoped>
.inspector { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.head { display: flex; gap: 8px; }
.name { flex: 1; font-weight: 600; font-size: 15px; background: none; border: 1px solid transparent; border-radius: 6px; padding: 4px 6px; color: var(--text); }
.name:hover, .name:focus { border-color: var(--line); outline: none; }
.desc { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.issues { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.issues li { font-size: 12px; padding: 6px 8px; border-radius: 6px; }
.issues .error { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); }
.issues .warning { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }
.field { display: grid; gap: 5px; }
.field > span { font: 600 11px var(--mono); color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.field input[type='text'], .field input[type='number'], .field select, .field textarea {
  width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px; border: 1px solid var(--line);
  background: var(--bg); color: var(--text); font: 13px var(--mono); resize: vertical;
}
.field :focus { outline: 2px solid color-mix(in srgb, var(--focus) 50%, transparent); outline-offset: -1px; }
.field small { color: var(--muted); font-size: 11.5px; }
.err { color: var(--err) !important; }
.run { border-top: 1px solid var(--line); padding-top: 10px; display: grid; gap: 6px; }
.run h4 { margin: 0; font: 600 11px var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.run .success { color: var(--ok); } .run .error { color: var(--err); }
.log { font: 11.5px var(--mono); color: var(--muted); }
summary { cursor: pointer; font-size: 12px; color: var(--muted); }
pre { margin: 6px 0 0; padding: 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; font: 11.5px/1.45 var(--mono); max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
.none { color: var(--muted); font-size: 13px; }
.tip code { font: 12px var(--mono); color: var(--text); }
.ghost { background: none; border: 1px solid var(--line); color: var(--muted); border-radius: 7px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px; }
.ghost.danger:hover { color: var(--err); border-color: var(--err); }
</style>
