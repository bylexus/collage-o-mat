import { signal } from '@angular/core';
import { History } from './history';

/**
 * `History` (undo/redo stack) with `canUndo`/`canRedo` as signals, for the toolbar buttons and
 * the keyboard shortcuts. Same methods and semantics as `History`.
 */
export class UndoHistory<T> {
  private readonly history = new History<T>();
  private readonly canUndoSignal = signal(false);
  private readonly canRedoSignal = signal(false);

  readonly canUndo = this.canUndoSignal.asReadonly();
  readonly canRedo = this.canRedoSignal.asReadonly();

  /** Starts a new history with the current state. */
  reset(initial: T): void {
    this.history.reset(initial);
    this.syncSignals();
  }

  /** Records the state after a committed change (clears the redo steps). */
  push(state: T): void {
    this.history.push(state);
    this.syncSignals();
  }

  /** The state to show after one undo step, or `null` if there is nothing to undo. */
  undo(): T | null {
    return this.afterStep(this.history.undo());
  }

  /** The state to show after one redo step, or `null` if there is nothing to redo. */
  redo(): T | null {
    return this.afterStep(this.history.redo());
  }

  private afterStep(state: T | null): T | null {
    this.syncSignals();
    return state;
  }

  private syncSignals(): void {
    this.canUndoSignal.set(this.history.canUndo);
    this.canRedoSignal.set(this.history.canRedo);
  }
}
