// Conversion of stored lengths (mm) to the display unit of the editor and back. Pure, no Angular.
import type { DisplayUnit } from '../../../core/models/collage';
import type { NumberLimits } from '../../../shared/number-limits';
import { mmToPx, pxToMm } from '../../../core/models/units';

/** Display unit of the editor lengths and the DPI for `px` (the collage DPI, `page.dpi`). */
export interface LengthUnit {
  readonly unit: DisplayUnit;
  readonly dpi: number;
}

/** The display value of a length in mm: the mm value unchanged, or whole pixels at the DPI. */
export function toDisplayLength(mm: number, { unit, dpi }: LengthUnit): number {
  return unit === 'px' ? Math.round(mmToPx(mm, dpi)) : mm;
}

/**
 * The length in mm of a display value (inverse of `toDisplayLength`). A px value gives mm rounded
 * to 3 decimals; the round trip px -> mm -> px gives the same px (the rounding error of at most
 * 0.0005 mm is below 0.5 px up to 25 400 DPI).
 */
export function fromDisplayLength(value: number, { unit, dpi }: LengthUnit): number {
  return unit === 'px' ? Math.round(pxToMm(value, dpi) * 1000) / 1000 : value;
}

/**
 * Limits of a length field in the display unit: the mm limits unchanged, or the mm limits as
 * rounded whole pixels (like the shown value, step 1). A px value at a rounded limit can be a bit
 * outside the mm range; the caller clamps the mm value into the mm limits.
 */
export function toDisplayLimits(limits: NumberLimits, { unit, dpi }: LengthUnit): NumberLimits {
  if (unit !== 'px') {
    return limits;
  }
  return {
    min: Math.round(mmToPx(limits.min, dpi)),
    max: Math.round(mmToPx(limits.max, dpi)),
    step: 1,
    integer: true,
  };
}

/** Label of a length field with the unit, e.g. "Width (px)". */
export function lengthLabel(label: string, { unit }: LengthUnit): string {
  return `${label} (${unit})`;
}
