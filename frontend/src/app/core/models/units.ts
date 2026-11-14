// Length unit conversions (mm, pt, px) shared by core models and the editor. Pure, no Angular.

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

/** Pixels for a length in mm at the given DPI. */
export function mmToPx(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi;
}

/** Millimetres for a font size in typographic points. */
export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH;
}

/** Millimetres for a length in pixels at the given DPI (inverse of `mmToPx`). */
export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * MM_PER_INCH;
}
