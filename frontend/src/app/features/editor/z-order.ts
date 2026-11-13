// Stacking order (`z`) of the elements on the page. Photos and texts share one z scale (higher is
// in front), so callers pass the z values of all elements. Pure functions: no Angular, no DOM.

/** z for a new element in front of all others: highest z + 1; 0 without elements. */
export function nextFrontZ(zs: readonly number[]): number {
  return zs.length === 0 ? 0 : highest(zs) + 1;
}

/**
 * New z that puts an element in front of all `others` (highest other z + 1); `null` if it is
 * already in front of all of them (no change needed).
 */
export function frontZ(z: number, others: readonly number[]): number | null {
  if (others.length === 0) {
    return null;
  }
  const top = highest(others);
  return z > top ? null : top + 1;
}

/**
 * New z that puts an element behind all `others` (lowest other z − 1); `null` if it is already
 * behind all of them (no change needed).
 */
export function backZ(z: number, others: readonly number[]): number | null {
  if (others.length === 0) {
    return null;
  }
  const bottom = lowest(others);
  return z < bottom ? null : bottom - 1;
}

function highest(zs: readonly number[]): number {
  return zs.reduce((max, z) => Math.max(max, z), -Infinity);
}

function lowest(zs: readonly number[]): number {
  return zs.reduce((min, z) => Math.min(min, z), Infinity);
}
