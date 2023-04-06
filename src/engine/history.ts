/**
 * Undo/redo by snapshot.
 *
 * The usual alternative is the command pattern — every edit is an object
 * with do() and undo(). That is efficient but every new kind of edit needs a
 * hand-written inverse, and one wrong inverse silently corrupts history.
 * Because the document is plain JSON and small, storing whole snapshots is
 * simpler and cannot drift out of sync with the editing code.
 *
 * Rapid edits of the same kind (dragging a node fires dozens of moves) are
 * coalesced by key, so one drag is one undo step, not forty.
 */

export class History<T> {
  private past: T[] = []
  private future: T[] = []
  private lastKey: string | null = null
  private lastAt = 0

  constructor(
    private readonly limit = 100,
    private readonly coalesceMs = 600,
  ) {}

  /** Record the state *before* a change. */
  push(snapshot: T, key?: string, now = Date.now()): void {
    const merge = key !== undefined && key === this.lastKey && now - this.lastAt < this.coalesceMs
    this.lastKey = key ?? null
    this.lastAt = now
    if (merge) return
    this.past.push(structuredClone(snapshot))
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }

  undo(current: T): T | null {
    const prev = this.past.pop()
    if (prev === undefined) return null
    this.future.push(structuredClone(current))
    this.lastKey = null
    return prev
  }

  redo(current: T): T | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(structuredClone(current))
    this.lastKey = null
    return next
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }
}
