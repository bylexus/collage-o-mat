// Undo/redo stack of immutable snapshots. Plain class: no Angular, no DOM.

/** Default maximum number of undo steps. */
export const HISTORY_LIMIT = 100;

/** Smallest accepted limit: at least one undo step. */
const MIN_LIMIT = 1;

/**
 * Linear undo/redo history. `reset(initial)` starts a new history; `push(state)` records the state AFTER a
 * committed change (and clears the redo stack); `undo()`/`redo()` return the state to show, or `null` if
 * there is nothing to undo/redo. The oldest entries are dropped beyond `limit`.
 *
 * `limit` is the maximum number of undo steps: the history keeps at most `limit + 1` snapshots (the oldest
 * reachable state plus `limit` changes). An invalid limit (non-finite or below 1) uses `HISTORY_LIMIT`;
 * a fractional limit is rounded down.
 *
 * States are stored as given (no copy); the caller passes immutable snapshots. A `push` before the first
 * `reset` makes that state the initial entry (nothing to undo yet).
 */
export class History<T> {
  // No parameter property: keeps the file runnable in plain Node (erasable TypeScript only).
  private readonly limit: number;
  /** Snapshots from oldest to newest. */
  private entries: T[] = [];
  /** Index of the current snapshot in `entries`; -1 = empty history. */
  private cursor = -1;

  constructor(limit: number = HISTORY_LIMIT) {
    this.limit = Number.isFinite(limit) && limit >= MIN_LIMIT ? Math.floor(limit) : HISTORY_LIMIT;
  }

  /** True if there is a snapshot before the current one. */
  get canUndo(): boolean {
    return this.cursor > 0;
  }

  /** True if there is a snapshot after the current one (after an undo, until the next push). */
  get canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  /** Starts a new history with `initial` as the only (current) snapshot. */
  reset(initial: T): void {
    this.entries = [initial];
    this.cursor = 0;
  }

  /**
   * Records `state` as the new current snapshot: drops all redo snapshots after the cursor, appends `state`
   * and drops the oldest snapshots so that at most `limit` undo steps remain.
   */
  push(state: T): void {
    const kept = this.entries.slice(0, this.cursor + 1);
    kept.push(state);
    const maxEntries = this.limit + 1;
    this.entries = kept.length > maxEntries ? kept.slice(kept.length - maxEntries) : kept;
    this.cursor = this.entries.length - 1;
  }

  /** Moves one step back and returns that snapshot, or `null` if there is nothing to undo. */
  undo(): T | null {
    if (!this.canUndo) {
      return null;
    }
    this.cursor -= 1;
    return this.entries[this.cursor];
  }

  /** Moves one step forward and returns that snapshot, or `null` if there is nothing to redo. */
  redo(): T | null {
    if (!this.canRedo) {
      return null;
    }
    this.cursor += 1;
    return this.entries[this.cursor];
  }
}
