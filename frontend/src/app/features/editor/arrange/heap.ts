// Heap arrangement: photos with random position, size and rotation, like prints thrown on a table.
// Pure, no Angular.
import type { HeapAspect, HeapSettings, PageSize } from '../../../core/models/collage';
import { frameSide } from '../geometry/frame-size';
import { clamp } from '../geometry/numbers';
import { contentRect } from '../geometry/rect';
import type { Rect } from '../geometry/rect';
import { photoAspect, rotatedFrame } from './frame';
import type { FrameCrop, Point } from './frame';
import type { ArrangePhoto, FrameMap } from './types';

/** Allowed range of `coveragePercent` (total photo area in % of the content area). */
export const HEAP_COVERAGE_PERCENT_MIN = 30;
export const HEAP_COVERAGE_PERCENT_MAX = 300;

/** Allowed range of `sizeVariationPercent` (± % of the side length). */
export const HEAP_SIZE_VARIATION_PERCENT_MIN = 0;
export const HEAP_SIZE_VARIATION_PERCENT_MAX = 50;

/** Allowed range of `maxRotationDeg` (± degrees). */
export const HEAP_MAX_ROTATION_DEG_MIN = 0;
export const HEAP_MAX_ROTATION_DEG_MAX = 45;

/** Values used when a setting is not a number (same as the collage defaults). */
const FALLBACK_COVERAGE_PERCENT = 120;
const FALLBACK_SIZE_VARIATION_PERCENT = 20;
const FALLBACK_MAX_ROTATION_DEG = 15;

const PERCENT = 100;

const DEG_TO_RAD = Math.PI / 180;

/** Random value used when the random source returns a non-finite value. */
const FALLBACK_RANDOM = 0.5;

/** Number of random candidate centres per photo; the one over the least covered area wins. */
const CANDIDATE_COUNT = 30;

/** Columns of the occupancy grid over the content area. */
const GRID_COLUMNS = 48;

/** Rows of the occupancy grid over the content area. */
const GRID_ROWS = 48;

/** Print aspects as width : height of the landscape frame (a portrait image gets height : width). */
const PRESET_ASPECTS: Readonly<Record<Exclude<HeapAspect, 'full'>, number>> = {
  '3:2': 3 / 2,
  '4:3': 4 / 3,
  '1:1': 1,
  '5:4': 5 / 4,
};

/** Width and height in mm. */
interface Size {
  width: number;
  height: number;
}

/** A frame on the page: centre, size and rotation in degrees around the centre. */
interface PlacedFrame {
  centre: Point;
  size: Size;
  rotationDeg: number;
}

/**
 * Coarse occupancy grid of the content area (`GRID_COLUMNS` × `GRID_ROWS` cells). A cell is covered
 * if its centre lies inside an already placed frame.
 */
interface OccupancyGrid {
  content: Rect;
  cellWidth: number;
  cellHeight: number;
  /** 1 = covered, 0 = free; index `row × GRID_COLUMNS + column`. */
  covered: Uint8Array;
}

/** First and last cell index (inclusive) on one axis; `first > last` = no cell. */
interface CellRange {
  first: number;
  last: number;
}

/** The heap settings limited to their allowed ranges (non-finite values give the defaults). */
interface SafeHeapSettings {
  aspect: HeapAspect;
  coveragePercent: number;
  sizeVariationPercent: number;
  maxRotationDeg: number;
}

/**
 * Arranges the photos as a random heap on the content area (page minus margin).
 *
 * - Base area per photo: `coveragePercent`% (clamped to 30..300) of the content area, divided by the
 *   photo count.
 * - Frame aspect: `full` = image aspect with a full crop; a preset `w:h` = `w/h` for a landscape or
 *   square image, `h/w` for a portrait image, with a centred cover crop. An unknown aspect counts as
 *   `full`.
 * - Size: the side lengths are scaled by a random factor in ±`sizeVariationPercent`% (clamped to 0..50).
 * - Rotation: random in ±`maxRotationDeg` (clamped to 0..45).
 * - A frame whose rotated bounding box is larger than the content area is scaled down to fit; sides
 *   are at least `MIN_FRAME_SIZE_MM`.
 * - Position: the best of `CANDIDATE_COUNT` random centres, each with the rotated bounding box fully
 *   inside the content area. A coarse occupancy grid of the content area marks the cells covered by
 *   the frames placed before; the candidate whose frame covers the fewest covered cells wins (ties:
 *   the first one). New photos so go to empty areas first and stay mostly visible (not guaranteed).
 * - z: the photos count up from 0 in their order (the last photo is on top).
 *
 * All photos are on the page; none is placed beside it.
 *
 * @param photos photos in arrangement order (the caller sorts by id)
 * @param random random source with values in [0, 1)
 */
export function arrangeHeap(
  photos: readonly ArrangePhoto[],
  page: PageSize,
  heap: HeapSettings,
  random: () => number,
): FrameMap {
  const frames: FrameMap = new Map();
  if (photos.length === 0) {
    return frames;
  }
  const settings = safeHeapSettings(heap);
  const content = contentRect(page, heap.marginMm);
  const baseArea =
    ((settings.coveragePercent / PERCENT) * content.width * content.height) / photos.length;
  const crop: FrameCrop = settings.aspect === 'full' ? 'full' : 'cover';
  const grid = createOccupancyGrid(content);

  photos.forEach((photo, index) => {
    const aspect = frameAspect(photoAspect(photo), settings.aspect);
    const scale = 1 + (settings.sizeVariationPercent / PERCENT) * randomSigned(random);
    const rotationDeg = settings.maxRotationDeg * randomSigned(random);
    const size = safeSize(
      fitRotated(sizeOfArea(baseArea * scale * scale, aspect), rotationDeg, content),
    );
    const centre = pickBestCentre(size, rotationDeg, grid, random);
    markCovered(grid, { centre, size, rotationDeg });
    frames.set(
      photo.id,
      rotatedFrame(photo, centre, size.width, size.height, rotationDeg, crop, index),
    );
  });
  return frames;
}

/** The settings limited to their allowed ranges; an unknown aspect gives `full`. */
function safeHeapSettings(heap: HeapSettings): SafeHeapSettings {
  return {
    aspect: Object.hasOwn(PRESET_ASPECTS, heap.aspect) ? heap.aspect : 'full',
    coveragePercent: clamp(
      heap.coveragePercent,
      HEAP_COVERAGE_PERCENT_MIN,
      HEAP_COVERAGE_PERCENT_MAX,
      FALLBACK_COVERAGE_PERCENT,
    ),
    sizeVariationPercent: clamp(
      heap.sizeVariationPercent,
      HEAP_SIZE_VARIATION_PERCENT_MIN,
      HEAP_SIZE_VARIATION_PERCENT_MAX,
      FALLBACK_SIZE_VARIATION_PERCENT,
    ),
    maxRotationDeg: clamp(
      heap.maxRotationDeg,
      HEAP_MAX_ROTATION_DEG_MIN,
      HEAP_MAX_ROTATION_DEG_MAX,
      FALLBACK_MAX_ROTATION_DEG,
    ),
  };
}

/**
 * Frame aspect (width / height): the image aspect for `full`, else the preset aspect in the
 * orientation of the image (landscape for an image aspect ≥ 1, else portrait).
 */
function frameAspect(imageAspect: number, aspect: HeapAspect): number {
  if (aspect === 'full') {
    return imageAspect;
  }
  const landscape = PRESET_ASPECTS[aspect];
  return imageAspect >= 1 ? landscape : 1 / landscape;
}

/** A random value in [0, 1] (a non-finite random value counts as 0.5). */
function randomUnit(random: () => number): number {
  return clamp(random(), 0, 1, FALLBACK_RANDOM);
}

/** A random value in [-1, 1] (a non-finite random value counts as 0). */
function randomSigned(random: () => number): number {
  return 2 * randomUnit(random) - 1;
}

/** Size with the given area and aspect (width / height). */
function sizeOfArea(area: number, aspect: number): Size {
  const width = Math.sqrt(area * aspect);
  return { width, height: width / aspect };
}

/** The size with both sides made safe by `frameSide` (at least `MIN_FRAME_SIZE_MM`). */
function safeSize(size: Size): Size {
  return { width: frameSide(size.width), height: frameSide(size.height) };
}

/** Axis-aligned bounding box size of a frame rotated by `rotationDeg` around its centre. */
function rotatedBoundingBox(size: Size, rotationDeg: number): Size {
  const cos = Math.abs(Math.cos(rotationDeg * DEG_TO_RAD));
  const sin = Math.abs(Math.sin(rotationDeg * DEG_TO_RAD));
  return {
    width: size.width * cos + size.height * sin,
    height: size.width * sin + size.height * cos,
  };
}

/** The size scaled down (same aspect) so that its rotated bounding box fits into the content area. */
function fitRotated(size: Size, rotationDeg: number, content: Rect): Size {
  const box = rotatedBoundingBox(size, rotationDeg);
  if (box.width <= content.width && box.height <= content.height) {
    return size;
  }
  const factor = Math.min(content.width / box.width, content.height / box.height);
  return { width: size.width * factor, height: size.height * factor };
}

/**
 * Centre of a frame: the best of `CANDIDATE_COUNT` random centres (`pickCentre`). The best one has the
 * fewest covered grid cells inside the frame; ties go to the first one. A candidate with no covered
 * cell stops the search (no later candidate can be better).
 */
function pickBestCentre(
  size: Size,
  rotationDeg: number,
  grid: OccupancyGrid,
  random: () => number,
): Point {
  const box = rotatedBoundingBox(size, rotationDeg);
  let best = pickCentre(box, grid.content, random);
  let bestScore = coveredCount(grid, { centre: best, size, rotationDeg });
  for (let candidate = 1; candidate < CANDIDATE_COUNT && bestScore > 0; candidate++) {
    const centre = pickCentre(box, grid.content, random);
    const score = coveredCount(grid, { centre, size, rotationDeg });
    if (score < bestScore) {
      best = centre;
      bestScore = score;
    }
  }
  return best;
}

/**
 * A random centre for a frame with the rotated bounding box `box`, fully inside the content area.
 * A box larger than the content area is centred on that axis.
 */
function pickCentre(box: Size, content: Rect, random: () => number): Point {
  return {
    x: randomCentre(content.x, content.width, box.width, random),
    y: randomCentre(content.y, content.height, box.height, random),
  };
}

/** Random centre on one axis for a box side `boxSize` inside `start .. start + length`. */
function randomCentre(
  start: number,
  length: number,
  boxSize: number,
  random: () => number,
): number {
  const slack = Math.max(0, length - boxSize);
  return start + (length - slack) / 2 + randomUnit(random) * slack;
}

/** An empty occupancy grid over the content area (a side of 0 gives cells of size 0). */
function createOccupancyGrid(content: Rect): OccupancyGrid {
  return {
    content,
    cellWidth: content.width / GRID_COLUMNS,
    cellHeight: content.height / GRID_ROWS,
    covered: new Uint8Array(GRID_COLUMNS * GRID_ROWS),
  };
}

/** Number of covered cells whose centres lie inside the frame. */
function coveredCount(grid: OccupancyGrid, frame: PlacedFrame): number {
  let count = 0;
  forEachCellInside(grid, frame, (index) => {
    count += grid.covered[index];
  });
  return count;
}

/** Marks all cells whose centres lie inside the frame as covered. */
function markCovered(grid: OccupancyGrid, frame: PlacedFrame): void {
  forEachCellInside(grid, frame, (index) => {
    grid.covered[index] = 1;
  });
}

/**
 * Calls `visit` with the index of each cell whose centre lies inside the rotated frame. Only the
 * cells inside the frame's rotated bounding box are tested.
 */
function forEachCellInside(
  grid: OccupancyGrid,
  frame: PlacedFrame,
  visit: (index: number) => void,
): void {
  const { centre, size } = frame;
  const { content } = grid;
  const box = rotatedBoundingBox(size, frame.rotationDeg);
  const columns = cellRange(centre.x, box.width, content.x, grid.cellWidth, GRID_COLUMNS);
  const rows = cellRange(centre.y, box.height, content.y, grid.cellHeight, GRID_ROWS);
  const cos = Math.cos(frame.rotationDeg * DEG_TO_RAD);
  const sin = Math.sin(frame.rotationDeg * DEG_TO_RAD);
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  for (let row = rows.first; row <= rows.last; row++) {
    const dy = cellCentre(content.y, grid.cellHeight, row) - centre.y;
    for (let column = columns.first; column <= columns.last; column++) {
      const dx = cellCentre(content.x, grid.cellWidth, column) - centre.x;
      // The cell centre in the frame's own (unrotated) axes.
      const along = dx * cos + dy * sin;
      const across = dy * cos - dx * sin;
      if (Math.abs(along) <= halfWidth && Math.abs(across) <= halfHeight) {
        visit(row * GRID_COLUMNS + column);
      }
    }
  }
}

/**
 * Cells on one axis whose centres lie inside `centre ± boxSize / 2`. A cell size of 0 (content side
 * of 0) gives all cells, as all their centres are at the same place.
 */
function cellRange(
  centre: number,
  boxSize: number,
  start: number,
  cellSize: number,
  cellCount: number,
): CellRange {
  if (!(cellSize > 0)) {
    return { first: 0, last: cellCount - 1 };
  }
  // Centre of cell i = start + (i + 0.5) × cellSize.
  const first = Math.ceil((centre - boxSize / 2 - start) / cellSize - 0.5);
  const last = Math.floor((centre + boxSize / 2 - start) / cellSize - 0.5);
  return { first: Math.max(0, first), last: Math.min(cellCount - 1, last) };
}

/** Centre of cell `index` on one axis. */
function cellCentre(start: number, cellSize: number, index: number): number {
  return start + (index + 0.5) * cellSize;
}
