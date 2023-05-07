/**
 * Shared geometry for nodes and ports.
 *
 * Port positions are computed from the model, not measured from the DOM.
 * Measuring would need a layout pass after every render, and edges would lag
 * a frame behind a dragged node; computing them keeps edges and nodes in the
 * same reactive update, so wires never visibly detach while dragging.
 */

import type { NodeDefinition, Point, WorkflowNode } from '@/engine/types'

export const NODE_WIDTH = 220
export const HEADER = 40
export const ROW = 26
export const PAD = 8

export function portPoint(node: WorkflowNode, def: NodeDefinition, side: 'in' | 'out', port: string): Point {
  const list = side === 'in' ? def.inputs : def.outputs
  const index = Math.max(0, list.findIndex((p) => p.name === port))
  return {
    x: node.position.x + (side === 'in' ? 0 : NODE_WIDTH),
    y: node.position.y + HEADER + PAD + index * ROW + ROW / 2,
  }
}

export function nodeHeight(def: NodeDefinition): number {
  return HEADER + PAD * 2 + Math.max(def.inputs.length, def.outputs.length, 1) * ROW
}

/** Horizontal-tangent cubic; control distance grows with span so long wires stay smooth. */
export function wire(a: Point, b: Point): string {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5)
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

export const CATEGORY_COLOR: Record<NodeDefinition['category'], string> = {
  Triggers: 'var(--c-trigger)',
  Network: 'var(--c-network)',
  Data: 'var(--c-data)',
  Logic: 'var(--c-logic)',
  Output: 'var(--c-output)',
}
