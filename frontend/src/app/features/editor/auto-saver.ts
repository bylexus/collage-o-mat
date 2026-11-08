import { signal } from '@angular/core';

/**
 * State of the auto-save:
 * - `saved`: no unsaved changes
 * - `pending`: changes wait for the debounce delay
 * - `saving`: a save request is running
 * - `error`: the last save failed; the changes are not saved
 */
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/** Default delay between the last change and the save. */
export const AUTO_SAVE_DELAY_MS = 1000;

/**
 * Debounced auto-save. `schedule()` after each committed change starts (or restarts) the delay;
 * then `save` is called. Only one save runs at a time: changes during a save cause one more save
 * after it. A failed save sets the status `error` and calls `onError`; the next change (or
 * `flush()`) tries again. `save` must always send the current full state.
 */
export class AutoSaver {
  private readonly statusSignal = signal<SaveStatus>('saved');
  /** Current state (for the status indicator and the "unsaved changes" warning). */
  readonly status = this.statusSignal.asReadonly();

  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly save: () => Promise<void>,
    private readonly onError: (err: unknown) => void,
    private readonly delayMs = AUTO_SAVE_DELAY_MS,
  ) {}

  /** Marks the state as changed and saves it after the delay. */
  schedule(): void {
    this.dirty = true;
    this.clearTimer();
    this.timer = setTimeout(() => void this.run(), this.delayMs);
    if (this.running === null) {
      this.statusSignal.set('pending');
    }
  }

  /** Saves at once if there are unsaved changes; resolves when no save is running any more. */
  flush(): Promise<void> {
    this.clearTimer();
    return this.run();
  }

  private run(): Promise<void> {
    this.timer = null;
    this.running ??= this.saveWhileDirty().finally(() => (this.running = null));
    return this.running;
  }

  /** Saves until no change is left, except changes that wait for their own delay. */
  private async saveWhileDirty(): Promise<void> {
    while (this.dirty && this.timer === null) {
      this.dirty = false;
      this.statusSignal.set('saving');
      try {
        await this.save();
      } catch (err) {
        this.dirty = true;
        this.statusSignal.set('error');
        this.onError(err);
        return;
      }
    }
    this.statusSignal.set(this.dirty ? 'pending' : 'saved');
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
