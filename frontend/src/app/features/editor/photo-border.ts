// Rules of the per-photo border override. Pure functions: no Angular, no DOM.
import {
  BORDER_TYPES,
  BorderSettings,
  CORNER_SIZE_MODES,
  POLAROID_FORMATS,
} from '../../core/models/collage';
import type { PhotoProps } from '../../core/models/photo';

/** The border drawn for the photo: its own border, or the collage `defaultBorder` without one. */
export function effectiveBorder(props: PhotoProps, defaultBorder: BorderSettings): BorderSettings {
  return ownBorder(props) ?? defaultBorder;
}

/**
 * True if the photo has an own border. Missing, `null` and values that are no valid
 * `BorderSettings` (e.g. the old format `{ widthMm, color }`) mean the collage `defaultBorder`.
 */
export function hasBorderOverride(props: PhotoProps): boolean {
  return ownBorder(props) !== null;
}

/** The own border of the photo; `null` if it has none (see `hasBorderOverride`). */
export function ownBorder(props: PhotoProps): BorderSettings | null {
  return isBorderSettings(props.border) ? props.border : null;
}

/** True if both borders have the same type and the same values of all types. */
export function sameBorder(a: BorderSettings, b: BorderSettings): boolean {
  return (
    a.type === b.type &&
    a.color.widthMm === b.color.widthMm &&
    a.color.color === b.color.color &&
    a.polaroid.format === b.polaroid.format &&
    a.polaroid.color === b.polaroid.color &&
    a.corners.color === b.corners.color &&
    a.corners.sizeMode === b.corners.sizeMode &&
    a.corners.sizeMm === b.corners.sizeMm &&
    a.corners.sizePercent === b.corners.sizePercent
  );
}

/** True if both are `null` or both are borders with the same values. */
export function sameOptionalBorder(a: BorderSettings | null, b: BorderSettings | null): boolean {
  return a === null || b === null ? a === b : sameBorder(a, b);
}

/** True if the value has a known `type` and the values of all types (a new-format border). */
function isBorderSettings(value: unknown): value is BorderSettings {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { type, color, polaroid, corners } = value as Partial<
    Record<keyof BorderSettings, unknown>
  >;
  return (
    BORDER_TYPES.some((item) => item === type) &&
    isColorBorder(color) &&
    isPolaroidBorder(polaroid) &&
    isCornersBorder(corners)
  );
}

function isColorBorder(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { widthMm, color } = value as Record<string, unknown>;
  return typeof widthMm === 'number' && Number.isFinite(widthMm) && typeof color === 'string';
}

function isPolaroidBorder(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { format, color } = value as Record<string, unknown>;
  return POLAROID_FORMATS.some((item) => item === format) && typeof color === 'string';
}

function isCornersBorder(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { color, sizeMode, sizeMm, sizePercent } = value as Record<string, unknown>;
  return (
    typeof color === 'string' &&
    CORNER_SIZE_MODES.some((item) => item === sizeMode) &&
    typeof sizeMm === 'number' &&
    Number.isFinite(sizeMm) &&
    typeof sizePercent === 'number' &&
    Number.isFinite(sizePercent)
  );
}
