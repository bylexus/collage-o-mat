// Axis-aligned rectangles in mm (page origin top-left). Pure, no Angular.
import type { PageSize } from '../../../core/models/collage';
import { nonNegative } from './numbers';

/** Axis-aligned rectangle in mm; `x`/`y` is the top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The page as a rectangle at the origin (invalid sizes count as 0). */
export function pageRect(page: PageSize): Rect {
  return { x: 0, y: 0, width: nonNegative(page.widthMm), height: nonNegative(page.heightMm) };
}

/**
 * The rectangle shrunk by `inset` on all sides. If the inset is larger than half a side, that side
 * becomes 0 and stays centred in the original rectangle.
 */
export function insetRect(rect: Rect, inset: number): Rect {
  const insetX = Math.min(inset, rect.width / 2);
  const insetY = Math.min(inset, rect.height / 2);
  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: rect.width - 2 * insetX,
    height: rect.height - 2 * insetY,
  };
}

/** The content area: page minus `marginMm` on all sides (a negative or invalid margin counts as 0). */
export function contentRect(page: PageSize, marginMm: number): Rect {
  return insetRect(pageRect(page), nonNegative(marginMm));
}

/** Right edge of the rectangle. */
export function rectRight(rect: Rect): number {
  return rect.x + rect.width;
}

/** Bottom edge of the rectangle. */
export function rectBottom(rect: Rect): number {
  return rect.y + rect.height;
}

/** Area of the rectangle in mm² (negative if one side is negative). */
export function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}
