// Masonry arrangement: justified lines (rows or columns) of equal thickness; the photos are
// distributed to the lines with as little crop as possible. Pure, no Angular.
import type { MasonrySettings, PageSize } from '../../../core/models/collage';
import { nonNegative, optionalCount, sum } from '../geometry/numbers';
import { contentRect } from '../geometry/rect';
import type { Rect } from '../geometry/rect';
import { photoAspect } from './frame';
import { justifiedLineFrames } from './justified-line';
import type { LineDirection } from './justified-line';
import { shuffle } from './shuffle';
import type { ArrangePhoto, FrameMap } from './types';

/** Largest line count tried by the automatic count (same as `SETTINGS_LIMITS.gridCount.max`). */
const MAX_AUTO_LINES = 20;

/** Maximum number of local search passes per split. */
const MAX_SEARCH_PASSES = 50;

/** Smallest fixed line count. */
const MIN_FIXED_LINE_COUNT = 1;

/** A change of the split must lower the crop cost by more than this (no loops from rounding). */
const MIN_IMPROVEMENT = 1e-9;

/** Size of the content area along and across the lines, and the gap between photos and lines. */
interface LineGeometry {
  /** Length of one line (rows: content width; columns: content height). */
  length: number;
  /** Side across all lines (rows: content height; columns: content width). */
  side: number;
  gap: number;
}

/** Random source for the random order, or `null` for the deterministic variant. */
type OrderRandom = (() => number) | null;

/**
 * A split of the photos into lines. Photos are indices into the input array; `lineOf[i]` is the line
 * of photo `i`, `lengthSums` and `counts` are the natural-length sum and the photo count per line.
 */
interface Split {
  lineOf: number[];
  lengthSums: number[];
  counts: number[];
}

/**
 * Arranges the photos in justified lines on the content area (page minus margin).
 *
 * - Direction `rows`: horizontal lines from top to bottom; `columns`: vertical lines from left to right.
 * - All lines have the same thickness; the photos of a line keep their relative size by image aspect
 *   and together fill the full line length (cover crop, see `justifiedLineFrames`).
 * - Line count: `count` (rounded down, at least 1) if set, also if it is larger than the photo count
 *   (then the first lines get one photo each, the other lines stay empty). `null` = auto: the count in
 *   `1..min(photo count, MAX_AUTO_LINES)` with the smallest crop cost (ties: the smaller count).
 * - Split: photos sorted by natural length descending (ties: id ascending), or shuffled with
 *   `random` if `masonry.randomOrder` is on; the first one per line, then each photo to the line with
 *   the smallest fill; then a local search (moves and swaps, first improvement, at most
 *   `MAX_SEARCH_PASSES` passes) lowers the crop cost. With random order, the auto count compares
 *   one random split per count.
 * - Crop cost of a line with `m` photos and stretch `s` (line length without gaps / natural length at
 *   the line thickness): `m × (1 − min(s, 1/s))`; `Infinity` if the line has no valid size.
 * - Order: photos in a line by id ascending, lines ordered by their smallest photo id; with random
 *   order, the photos in each line and the line order are shuffled. z counts up from 0 over the lines
 *   in this order.
 * - If the content area is too small, the frames get the minimal frame size (no NaN).
 *
 * All photos are on the page; none is placed beside it.
 *
 * @param photos photos in id-ascending order (the caller sorts by id; never shuffled before)
 * @param random random source with values in [0, 1) (used only if `masonry.randomOrder` is on)
 */
export function arrangeMasonry(
  photos: readonly ArrangePhoto[],
  page: PageSize,
  masonry: MasonrySettings,
  random: () => number,
): FrameMap {
  const frames: FrameMap = new Map();
  if (photos.length === 0) {
    return frames;
  }
  const content = contentRect(page, masonry.marginMm);
  const direction: LineDirection = masonry.direction === 'columns' ? 'column' : 'row';
  const geometry = lineGeometry(content, direction, nonNegative(masonry.gapMm));
  const lengths = photos.map((photo) => naturalLength(photo, direction));
  const orderRandom: OrderRandom = masonry.randomOrder ? random : null;
  const fixedCount = optionalCount(masonry.count, MIN_FIXED_LINE_COUNT);
  const { count, lines } =
    fixedCount !== null
      ? { count: fixedCount, lines: splitLines(lengths, fixedCount, geometry, orderRandom) }
      : bestAutoSplit(lengths, geometry, orderRandom);
  const thickness = lineThickness(count, geometry);

  let z = 0;
  orderedLines(lines, photos, orderRandom).forEach((line, index) => {
    const linePhotos = line.map((photoIndex) => photos[photoIndex]);
    const rect = lineRect(content, direction, thickness, geometry.gap, index);
    justifiedLineFrames({ rect, direction }, linePhotos, geometry.gap, z).forEach((props, id) =>
      frames.set(id, props),
    );
    z += linePhotos.length;
  });
  return frames;
}

/** Relative size of the photo along the line (image height = 1); same as in `justified-line.ts`. */
function naturalLength(photo: ArrangePhoto, direction: LineDirection): number {
  const aspect = photoAspect(photo);
  return direction === 'row' ? aspect : 1 / aspect;
}

/** Line length and side of the content area for the direction. */
function lineGeometry(content: Rect, direction: LineDirection, gap: number): LineGeometry {
  return direction === 'row'
    ? { length: content.width, side: content.height, gap }
    : { length: content.height, side: content.width, gap };
}

/** Thickness of each of `count` lines: the side minus the gaps between the lines, divided equally. */
function lineThickness(count: number, geometry: LineGeometry): number {
  return (geometry.side - (count - 1) * geometry.gap) / count;
}

/**
 * The auto count: the split with the smallest crop cost for `1..min(n, MAX_AUTO_LINES)` lines
 * (ties: the smaller count; all costs `Infinity` gives 1 line).
 */
function bestAutoSplit(
  lengths: readonly number[],
  geometry: LineGeometry,
  random: OrderRandom,
): { count: number; lines: number[][] } {
  const maxCount = Math.min(lengths.length, MAX_AUTO_LINES);
  let best = { count: 1, lines: splitLines(lengths, 1, geometry, random) };
  let bestCost = splitCost(best.lines, lengths, lineThickness(1, geometry), geometry);
  for (let count = 2; count <= maxCount; count++) {
    const lines = splitLines(lengths, count, geometry, random);
    const cost = splitCost(lines, lengths, lineThickness(count, geometry), geometry);
    if (cost < bestCost) {
      best = { count, lines };
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Splits the photos (indices into `lengths`) into `count` lines. Fewer photos than lines: photo `i`
 * alone in line `i`, the other lines are empty and not returned. Else every line gets at least one
 * photo: greedy best fit (random variant if `random` is set), then the local search.
 */
function splitLines(
  lengths: readonly number[],
  count: number,
  geometry: LineGeometry,
  random: OrderRandom,
): number[][] {
  if (lengths.length < count) {
    return lengths.map((_, index) => [index]);
  }
  const thickness = lineThickness(count, geometry);
  const split = greedySplit(lengths, count, thickness, geometry.gap, random);
  improveSplit(split, lengths, thickness, geometry);
  return linesOf(split, count);
}

/**
 * Greedy split: photos by natural length descending (ties: lower index = smaller id), or shuffled
 * with `random` if set; the first `count` photos one per line, then each photo to the line with the
 * smallest fill `thickness × length sum + photo count × gap` (ties: lower line index).
 */
function greedySplit(
  lengths: readonly number[],
  count: number,
  thickness: number,
  gap: number,
  random: OrderRandom,
): Split {
  const order = lengths.map((_, index) => index);
  if (random) {
    shuffle(order, random);
  } else {
    order.sort((a, b) => lengths[b] - lengths[a] || a - b);
  }
  const split: Split = {
    lineOf: new Array<number>(lengths.length).fill(0),
    lengthSums: new Array<number>(count).fill(0),
    counts: new Array<number>(count).fill(0),
  };
  order.forEach((photo, position) => {
    const line = position < count ? position : leastFilledLine(split, thickness, gap);
    split.lineOf[photo] = line;
    split.lengthSums[line] += lengths[photo];
    split.counts[line] += 1;
  });
  return split;
}

/** Index of the line with the smallest fill (ties: lower index). */
function leastFilledLine(split: Split, thickness: number, gap: number): number {
  let best = 0;
  let bestFill = Infinity;
  split.lengthSums.forEach((lengthSum, line) => {
    const fill = thickness * lengthSum + split.counts[line] * gap;
    if (fill < bestFill) {
      best = line;
      bestFill = fill;
    }
  });
  return best;
}

/**
 * Local search on the split (changed in place): passes over all moves (a photo to another line, if
 * its line keeps at least one photo) and all swaps (two photos in different lines). A change is
 * applied at once if it lowers the crop cost by more than `MIN_IMPROVEMENT` (first improvement).
 * Stops after a pass without change or after `MAX_SEARCH_PASSES` passes.
 */
function improveSplit(
  split: Split,
  lengths: readonly number[],
  thickness: number,
  geometry: LineGeometry,
): void {
  const cost = (lengthSum: number, count: number): number =>
    lineCost(lengthSum, count, thickness, geometry);
  const { lineOf, lengthSums, counts } = split;
  const lineCount = lengthSums.length;
  for (let pass = 0; pass < MAX_SEARCH_PASSES; pass++) {
    let improved = false;
    for (let photo = 0; photo < lengths.length; photo++) {
      for (let target = 0; target < lineCount; target++) {
        const source = lineOf[photo];
        if (target === source || counts[source] <= 1) {
          continue;
        }
        const length = lengths[photo];
        const before =
          cost(lengthSums[source], counts[source]) + cost(lengthSums[target], counts[target]);
        const after =
          cost(lengthSums[source] - length, counts[source] - 1) +
          cost(lengthSums[target] + length, counts[target] + 1);
        if (isImprovement(before, after)) {
          lineOf[photo] = target;
          lengthSums[source] -= length;
          counts[source] -= 1;
          lengthSums[target] += length;
          counts[target] += 1;
          improved = true;
        }
      }
    }
    for (let first = 0; first < lengths.length; first++) {
      for (let second = first + 1; second < lengths.length; second++) {
        const firstLine = lineOf[first];
        const secondLine = lineOf[second];
        if (firstLine === secondLine) {
          continue;
        }
        const delta = lengths[second] - lengths[first];
        const before =
          cost(lengthSums[firstLine], counts[firstLine]) +
          cost(lengthSums[secondLine], counts[secondLine]);
        const after =
          cost(lengthSums[firstLine] + delta, counts[firstLine]) +
          cost(lengthSums[secondLine] - delta, counts[secondLine]);
        if (isImprovement(before, after)) {
          lineOf[first] = secondLine;
          lineOf[second] = firstLine;
          lengthSums[firstLine] += delta;
          lengthSums[secondLine] -= delta;
          improved = true;
        }
      }
    }
    if (!improved) {
      return;
    }
  }
}

/** True if `after` is lower than `before` by more than `MIN_IMPROVEMENT` (never if both are `Infinity`). */
function isImprovement(before: number, after: number): boolean {
  return after < before - MIN_IMPROVEMENT;
}

/**
 * Crop cost of a line with `count` photos and the natural-length sum `lengthSum`: the sum of the
 * cropped area fractions of its photos, `count × (1 − min(s, 1/s))` with the stretch
 * `s = (line length − (count − 1) × gap) / (thickness × lengthSum)`. 0 for an empty line; `Infinity`
 * if the thickness or the available length is not positive.
 */
function lineCost(
  lengthSum: number,
  count: number,
  thickness: number,
  geometry: LineGeometry,
): number {
  if (count === 0) {
    return 0;
  }
  const available = geometry.length - (count - 1) * geometry.gap;
  const stretch = available / (thickness * lengthSum);
  if (!(thickness > 0) || !(available > 0) || !Number.isFinite(stretch) || stretch <= 0) {
    return Infinity;
  }
  return count * (1 - Math.min(stretch, 1 / stretch));
}

/** Crop cost of a split: the sum of the line costs. */
function splitCost(
  lines: readonly number[][],
  lengths: readonly number[],
  thickness: number,
  geometry: LineGeometry,
): number {
  return sum(
    lines.map((line) =>
      lineCost(sum(line.map((photo) => lengths[photo])), line.length, thickness, geometry),
    ),
  );
}

/** The photos (indices, ascending) of each of the `count` lines of the split. */
function linesOf(split: Split, count: number): number[][] {
  const lines: number[][] = Array.from({ length: count }, () => []);
  split.lineOf.forEach((line, photo) => lines[line].push(photo));
  return lines;
}

/**
 * The lines in output order: photos in a line by id ascending, lines by their smallest photo id; with
 * `random`, the photos in each line and the line order are shuffled. Empty lines are not returned
 * (they are always the last lines).
 */
function orderedLines(
  lines: readonly number[][],
  photos: readonly ArrangePhoto[],
  random: OrderRandom,
): number[][] {
  const filled = lines.filter((line) => line.length > 0).map((line) => [...line]);
  if (random) {
    filled.forEach((line) => shuffle(line, random));
    shuffle(filled, random);
    return filled;
  }
  const byId = (a: number, b: number): number => photos[a].id - photos[b].id;
  return filled.map((line) => line.sort(byId)).sort((a, b) => byId(a[0], b[0]));
}

/** Rectangle of line `index`: rows from the top, columns from the left, each `thickness` thick. */
function lineRect(
  content: Rect,
  direction: LineDirection,
  thickness: number,
  gap: number,
  index: number,
): Rect {
  const offset = index * (thickness + gap);
  return direction === 'row'
    ? { x: content.x, y: content.y + offset, width: content.width, height: thickness }
    : { x: content.x + offset, y: content.y, width: thickness, height: content.height };
}
