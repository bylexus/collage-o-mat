// Small numeric guards shared by the geometry and arrangement functions. Pure, no Angular.

/** True for a finite number greater than 0. */
export function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** The value if it is finite and not negative, else 0 (for margins, gaps and sizes from user input). */
export function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Limits `value` to `min..max`; a non-finite value gives `fallback` (default `min`). */
export function clamp(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** Sum of the values (0 for an empty list). */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * A whole-number count from a setting, or `null` = not set (computed automatically).
 * A finite value is rounded down and is at least `min`; `null` and non-finite values give `null`.
 */
export function optionalCount(value: number | null, min: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(min, Math.floor(value));
}
