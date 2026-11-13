// Rules of the per-photo border override. Pure functions: no Angular, no DOM.
import type { PhotoBorder } from '../../core/models/photo';

/** Border that uses the collage `defaultBorder` (a new object). */
export function inheritedBorder(): PhotoBorder {
  return { widthMm: null, color: null };
}

/** True if the border overrides the width or the colour of the collage `defaultBorder`. */
export function hasBorderOverride(border: PhotoBorder): boolean {
  return border.widthMm !== null || border.color !== null;
}

/** True if both borders have the same width and colour. */
export function sameBorder(a: PhotoBorder, b: PhotoBorder): boolean {
  return a.widthMm === b.widthMm && a.color === b.color;
}
