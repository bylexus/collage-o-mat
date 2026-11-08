// Grid arrangement: equal cells in rows and columns, cover crop per cell. Pure, no Angular.
import type { GridSettings, PageSize } from '../../../core/models/collage';
import { isPositiveFinite, nonNegative, optionalCount } from '../geometry/numbers';
import { contentRect } from '../geometry/rect';
import type { Rect } from '../geometry/rect';
import { placeBesidePage } from './beside-page';
import { coverFrame } from './frame';
import type { ArrangePhoto, FrameMap } from './types';

/** Content aspect used when the content area has no valid size. */
const FALLBACK_CONTENT_ASPECT = 1;

/** Smallest fixed row/column count. */
const MIN_FIXED_GRID_COUNT = 1;

/** Number of rows and columns of the grid. */
export interface GridDimensions {
  rows: number;
  cols: number;
}

/** Size of one grid cell in mm. */
interface CellSize {
  width: number;
  height: number;
}

/**
 * Arranges the photos in a grid on the content area (page minus margin).
 *
 * - Photo `i` (in the given order) gets cell `i` (row-major), a centred cover crop and `z = i`.
 * - Photos beyond `rows × cols` are placed beside the page with frame width = cell width and z continuing.
 * - Empty cells stay empty.
 * - If the content area is too small for the cells, the cells get the minimal frame size (no NaN; frames
 *   can then overlap or leave the content area).
 *
 * @param photos photos in arrangement order (the caller sorts by id)
 */
export function arrangeGrid(
  photos: readonly ArrangePhoto[],
  page: PageSize,
  grid: GridSettings,
): FrameMap {
  const frames: FrameMap = new Map();
  if (photos.length === 0) {
    return frames;
  }
  const content = contentRect(page, grid.marginMm);
  const gap = nonNegative(grid.gapMm);
  const dimensions = gridDimensions(photos.length, contentAspect(content), grid);
  const cell = cellSize(content, dimensions, gap);
  const capacity = dimensions.rows * dimensions.cols;

  photos.slice(0, capacity).forEach((photo, index) => {
    frames.set(
      photo.id,
      coverFrame(photo, cellRect(content, cell, gap, dimensions.cols, index), index),
    );
  });
  const overflow = placeBesidePage(photos.slice(capacity), page, cell.width, capacity);
  overflow.forEach((props, id) => frames.set(id, props));
  return frames;
}

/**
 * Rows and columns for `count` photos: fixed values from the settings, missing ones computed.
 * Both null: `cols = min(ceil(sqrt(count × aspect)), count)` (never more columns than photos),
 * `rows = ceil(count / cols)`.
 * Only one set: the other is `ceil(count / set)`. A fixed value below 1 or with decimals is rounded down to
 * a whole number of at least 1; a non-finite value counts as not set.
 */
export function gridDimensions(
  count: number,
  aspect: number,
  grid: Pick<GridSettings, 'rows' | 'cols'>,
): GridDimensions {
  const fixedRows = optionalCount(grid.rows, MIN_FIXED_GRID_COUNT);
  const fixedCols = optionalCount(grid.cols, MIN_FIXED_GRID_COUNT);
  if (fixedRows !== null && fixedCols !== null) {
    return { rows: fixedRows, cols: fixedCols };
  }
  if (fixedCols !== null) {
    return { rows: Math.ceil(count / fixedCols), cols: fixedCols };
  }
  if (fixedRows !== null) {
    return { rows: fixedRows, cols: Math.ceil(count / fixedRows) };
  }
  const cols = Math.max(1, Math.min(Math.ceil(Math.sqrt(count * aspect)), count));
  return { rows: Math.ceil(count / cols), cols };
}

/** Width / height of the content area; `FALLBACK_CONTENT_ASPECT` if it has no valid size. */
function contentAspect(content: Rect): number {
  return isPositiveFinite(content.width) && isPositiveFinite(content.height)
    ? content.width / content.height
    : FALLBACK_CONTENT_ASPECT;
}

/** Cell size: content minus the gaps between cells, divided by the number of cells per side. */
function cellSize(content: Rect, dimensions: GridDimensions, gap: number): CellSize {
  return {
    width: (content.width - (dimensions.cols - 1) * gap) / dimensions.cols,
    height: (content.height - (dimensions.rows - 1) * gap) / dimensions.rows,
  };
}

/** Rectangle of cell `index` (row-major). */
function cellRect(content: Rect, cell: CellSize, gap: number, cols: number, index: number): Rect {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return {
    x: content.x + col * (cell.width + gap),
    y: content.y + row * (cell.height + gap),
    width: cell.width,
    height: cell.height,
  };
}
