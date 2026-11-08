import { effect, Signal, untracked } from '@angular/core';

/**
 * Calls `apply` with the current value of `source` and again on every change (e.g. to show a new
 * input value in a form). `apply` runs untracked, so the signals it reads are no dependencies.
 *
 * Must be called in an injection context (e.g. a field initializer of a component).
 */
export function syncFromInput<T>(source: Signal<T>, apply: (value: T) => void): void {
  effect(() => {
    const value = source();
    untracked(() => apply(value));
  });
}
