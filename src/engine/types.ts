/**
 * Core model.
 *
 * The workflow is plain data — no class instances, no functions — so it can
 * be serialised, diffed for undo/redo, and stored without a custom codec.
 * Behaviour lives in node *definitions*, looked up by `type` at run time.
 * That split is what makes a low-code tool extensible: adding a node kind
 * never changes the document format.
 */

export type PortType = 'any' | 'string' | 'number' | 'boolean' | 'object' | 'array'

export interface PortSpec {
  name: string
  type: PortType
  label?: string
  /** Inputs only: must be connected for the node to run. */
  required?: boolean
}

export type FieldSpec =
  | { key: string; label: string; kind: 'text' | 'textarea'; default: string; placeholder?: string; help?: string }
  | { key: string; label: string; kind: 'number'; default: number; min?: number; max?: number; help?: string }
  | { key: string; label: string; kind: 'select'; default: string; options: string[]; help?: string }
  | { key: string; label: string; kind: 'json'; default: unknown; help?: string }
  | { key: string; label: string; kind: 'boolean'; default: boolean; help?: string }

export interface NodeContext {
  inputs: Record<string, unknown>
  config: Record<string, unknown>
  signal: AbortSignal
  log: (message: string) => void
}

/**
 * A node returns values keyed by output port. Leaving a port out of the
 * result means "this branch did not fire" — the mechanism behind condition
 * nodes and skip propagation, without a special branch type in the graph.
 */
export type NodeResult = Record<string, unknown>

export interface NodeDefinition {
  type: string
  label: string
  category: 'Triggers' | 'Network' | 'Data' | 'Logic' | 'Output'
  description: string
  inputs: PortSpec[]
  outputs: PortSpec[]
  fields: FieldSpec[]
  /** Hard limit; the executor aborts the node after this many ms. */
  timeoutMs?: number
  run: (ctx: NodeContext) => Promise<NodeResult>
}

export interface Point {
  x: number
  y: number
}

export interface WorkflowNode {
  id: string
  type: string
  label?: string
  position: Point
  config: Record<string, unknown>
}

export interface Endpoint {
  node: string
  port: string
}

export interface WorkflowEdge {
  id: string
  from: Endpoint
  to: Endpoint
}

export interface Workflow {
  version: number
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type NodeStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'skipped' | 'cancelled'

export interface NodeRunState {
  status: NodeStatus
  startedAt?: number
  finishedAt?: number
  inputs?: Record<string, unknown>
  outputs?: NodeResult
  error?: string
  logs: string[]
}
