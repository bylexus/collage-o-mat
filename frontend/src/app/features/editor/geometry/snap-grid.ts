// Snap grid math for moving and resizing elements by hand. Pure, no Angular, no Konva.
import type { ArrangementMode, CollageSettings } from '../../../core/models/collage';
import { isPositiveFinite, nonNegative } from './numbers';
import type { Rect } from './rect';

/**
 * Grid lines of one axis (mm): `marginMm + n · sizeMm` for every integer n (also outside the
 * page), plus the far margin line `farLineMm` (page side − margin).
 */
export interface SnapAxis {
  marginMm: number;
  sizeMm: number;
  farLineMm: number;
}

/** The snap grid of the page: one set of lines per axis (same cell size and margin). */
export interface SnapGrid {
  x: SnapAxis;
  y: SnapAxis;
}

/** The margin setting of each arrangement mode. */
const MODE_MARGIN_MM: Readonly<Record<ArrangementMode, (settings: CollageSettings) => number>> = {
  grid: (settings) => settings.grid.marginMm,
  center: (settings) => settings.center.marginMm,
  heap: (settings) => settings.heap.marginMm,
};

/** Shift (mm) that puts an element on the grid. */
export interface SnapDelta {
  dx: number;
  dy: number;
}

/**
 * The snap grid of the collage settings, or `null` when snapping is off (grid disabled or an
 * invalid cell size). The margin is the one of the active arrangement mode; an invalid margin
 * counts as 0.
 */
export function snapGridOf(settings: CollageSettings): SnapGrid | null {
  const { enabled, sizeMm } = settings.snapGrid;
  if (!enabled || !isPositiveFinite(sizeMm)) {
    return null;
  }
  const marginMm = nonNegative(MODE_MARGIN_MM[settings.mode](settings));
  return {
    x: { marginMm, sizeMm, farLineMm: settings.page.widthMm - marginMm },
    y: { marginMm, sizeMm, farLineMm: settings.page.heightMm - marginMm },
  };
}

/**
 * The grid line of the axis that is nearest to `valueMm` (the value itself if it or the axis is
 * invalid). On a tie the regular grid line wins over the far margin line.
 */
export function snapToAxis(valueMm: number, axis: SnapAxis): number {
  if (!Number.isFinite(valueMm) || !isPositiveFinite(axis.sizeMm)) {
    return valueMm;
  }
  const steps = Math.round((valueMm - axis.marginMm) / axis.sizeMm);
  const gridLine = axis.marginMm + steps * axis.sizeMm;
  const far = axis.farLineMm;
  if (Number.isFinite(far) && Math.abs(far - valueMm) < Math.abs(gridLine - valueMm)) {
    return far;
  }
  return gridLine;
}

/**
 * Shift along one axis that puts the nearer of both edges (`startMm`, `endMm`) on its nearest grid
 * line. On a tie the start edge (left/top) snaps. 0 for invalid values.
 */
export function snapEdgesDelta(startMm: number, endMm: number, axis: SnapAxis): number {
  const startDelta = snapToAxis(startMm, axis) - startMm;
  const endDelta = snapToAxis(endMm, axis) - endMm;
  const delta = Math.abs(endDelta) < Math.abs(startDelta) ? endDelta : startDelta;
  return Number.isFinite(delta) ? delta : 0;
}

/**
 * Shift that snaps an axis-aligned rectangle (e.g. the bounding box of a rotated element): per
 * axis the edge (left or right, top or bottom) that is nearer to a grid line lands on it.
 */
export function snapRectDelta(rect: Rect, grid: SnapGrid): SnapDelta {
  return {
    dx: snapEdgesDelta(rect.x, rect.x + rect.width, grid.x),
    dy: snapEdgesDelta(rect.y, rect.y + rect.height, grid.y),
  };
}

/** The edge of one axis a resize handle moves: start (left/top), end (right/bottom) or none. */
export type MovingEdge = 'start' | 'end' | null;

/** The edges a resize handle moves, per axis of an axis-aligned box. */
export interface MovingEdges {
  x: MovingEdge;
  y: MovingEdge;
}

/** The edges of one axis (mm). */
interface Span {
  start: number;
  end: number;
}

/**
 * Snaps an axis-aligned box (mm) that a resize handle changes; the edges that do not move stay.
 * - One moving edge: it lands on its nearest grid line.
 * - A moving edge on both axes with `keepAspect`: the edge that is nearer to its grid line lands
 *   on it (a tie: the x edge), the other side follows from the aspect of `rect`, so the opposite
 *   corner stays.
 * - A moving edge on both axes without `keepAspect`: both land on their nearest grid line.
 *
 * Returns `rect` unchanged if it has no positive finite size, or if the snapped box would have a
 * side of 0 or less (the snapped edge would pass the fixed one).
 */
export function snapResizeRect(
  rect: Rect,
  moving: MovingEdges,
  keepAspect: boolean,
  grid: SnapGrid,
): Rect {
  if (!isPositiveFinite(rect.width) || !isPositiveFinite(rect.height)) {
    return rect;
  }
  let xs: Span = { start: rect.x, end: rect.x + rect.width };
  let ys: Span = { start: rect.y, end: rect.y + rect.height };
  if (keepAspect && moving.x && moving.y) {
    const aspect = rect.width / rect.height;
    const dx = edgeSnapDelta(xs, moving.x, grid.x);
    const dy = edgeSnapDelta(ys, moving.y, grid.y);
    if (Math.abs(dx) <= Math.abs(dy)) {
      xs = moveEdge(xs, moving.x, dx);
      ys = withLength(ys, moving.y, (xs.end - xs.start) / aspect);
    } else {
      ys = moveEdge(ys, moving.y, dy);
      xs = withLength(xs, moving.x, (ys.end - ys.start) * aspect);
    }
  } else {
    if (moving.x) {
      xs = moveEdge(xs, moving.x, edgeSnapDelta(xs, moving.x, grid.x));
    }
    if (moving.y) {
      ys = moveEdge(ys, moving.y, edgeSnapDelta(ys, moving.y, grid.y));
    }
  }
  const snapped = { x: xs.start, y: ys.start, width: xs.end - xs.start, height: ys.end - ys.start };
  return isPositiveFinite(snapped.width) && isPositiveFinite(snapped.height) ? snapped : rect;
}

/** Shift of the moving edge onto its nearest grid line (0 for invalid values). */
function edgeSnapDelta(span: Span, edge: 'start' | 'end', axis: SnapAxis): number {
  const value = span[edge];
  const delta = snapToAxis(value, axis) - value;
  return Number.isFinite(delta) ? delta : 0;
}

/** The span with the edge shifted by `delta`. */
function moveEdge(span: Span, edge: 'start' | 'end', delta: number): Span {
  return { ...span, [edge]: span[edge] + delta };
}

/** The span with the given length; the edge that does not move stays. */
function withLength(span: Span, moving: 'start' | 'end', length: number): Span {
  return moving === 'start'
    ? { start: span.end - length, end: span.end }
    : { start: span.start, end: span.start + length };
}
