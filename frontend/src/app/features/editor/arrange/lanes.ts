// Photo counts per lane and the split of the photos into lanes. Pure, no Angular.
import { sum } from '../geometry/numbers';

/** What the count rules need to know about one lane. */
export interface LaneCountInput {
  /** Fixed photo count (whole number ≥ 0), or `null` = auto (share of the photos by area). */
  fixedCount: number | null;
  /** Area of the lane in mm²; the weight of an auto lane. */
  area: number;
  /** False if the lane has no space (a side ≤ 0); it then holds no photos. */
  usable: boolean;
}

/** Photos split into lanes: one group per lane (in lane order) and the photos that do not fit. */
export interface LaneSplit<T> {
  groups: T[][];
  rest: T[];
}

/**
 * Number of photos each lane holds when `photoCount` photos are distributed:
 * - a usable lane with a fixed count holds exactly that count (also if there are fewer photos; the
 *   lanes are then filled in order by `splitByCapacities` and later lanes stay empty);
 * - the photos not reserved by fixed counts are distributed over the usable auto lanes in proportion to
 *   their area (largest remainder method, ties go to the earlier lane);
 * - an unusable lane holds 0 photos. Its fixed count still reserves photos (they are not given to the
 *   auto lanes), so these photos do not fit and go beside the page.
 *
 * The sum of the capacities can be smaller than `photoCount` (all lanes fixed, unusable lanes, no usable
 * auto lane) or larger (fixed counts larger than the photo count).
 */
export function laneCapacities(photoCount: number, lanes: readonly LaneCountInput[]): number[] {
  const reserved = sum(lanes.map((lane) => lane.fixedCount ?? 0));
  const autoPool = Math.max(0, photoCount - reserved);
  const autoIndices = lanes.flatMap((lane, index) => (isAutoLane(lane) ? [index] : []));
  const shares = largestRemainder(
    autoPool,
    autoIndices.map((index) => lanes[index].area),
  );
  const capacities = lanes.map((lane) => (lane.usable ? (lane.fixedCount ?? 0) : 0));
  autoIndices.forEach((laneIndex, shareIndex) => {
    capacities[laneIndex] = shares[shareIndex];
  });
  return capacities;
}

/** True for a usable lane without a fixed count. */
function isAutoLane(lane: LaneCountInput): boolean {
  return lane.usable && lane.fixedCount === null;
}

/**
 * Splits `total` into whole numbers proportional to `weights` (largest remainder / Hamilton method).
 * Ties in the remainder go to the earlier weight. Non-positive total weight gives equal weights.
 */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  const weightSum = sum(weights);
  const safeWeights = weightSum > 0 ? weights : weights.map(() => 1);
  const safeSum = weightSum > 0 ? weightSum : weights.length;
  const quotas = safeWeights.map((weight) => (total * weight) / safeSum);
  const counts = quotas.map(Math.floor);
  const missing = total - sum(counts);
  quotas
    .map((quota, index) => ({ index, remainder: quota - counts[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, missing)
    .forEach(({ index }) => counts[index]++);
  return counts;
}

/**
 * Fills the lanes in order: the first `capacities[0]` items go to lane 0, the next ones to lane 1, etc.
 * Items beyond the total capacity are in `rest`; lanes after the last item stay empty.
 */
export function splitByCapacities<T>(
  items: readonly T[],
  capacities: readonly number[],
): LaneSplit<T> {
  let start = 0;
  const groups = capacities.map((capacity) => {
    const group = items.slice(start, start + capacity);
    start += group.length;
    return group;
  });
  return { groups, rest: items.slice(start) };
}
