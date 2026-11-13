// Frame size guards shared by the arrangement strategies and the editor transform math. Pure, no Angular.

/** Smallest frame side in mm; protects against zero, negative or invalid sizes. */
export const MIN_FRAME_SIZE_MM = 1;

/** A frame side of at least `MIN_FRAME_SIZE_MM` (also for NaN and infinite values). */
export function frameSide(sizeMm: number): number {
  return Number.isFinite(sizeMm) ? Math.max(MIN_FRAME_SIZE_MM, sizeMm) : MIN_FRAME_SIZE_MM;
}
