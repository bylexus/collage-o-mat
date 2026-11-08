// Center arrangement: one large photo in the middle, the others in lanes around it (top, middle, bottom).
// Pure, no Angular.
import type { CenterSettings, PageSize } from '../../../core/models/collage';
import { clamp, nonNegative, optionalCount, sum } from '../geometry/numbers';
import { contentRect, rectArea, rectBottom, rectRight } from '../geometry/rect';
import type { Rect } from '../geometry/rect';
import { placeBesidePage } from './beside-page';
import { fullFrame, photoAspect } from './frame';
import { justifiedLineFrames } from './justified-line';
import type { Line } from './justified-line';
import { laneCapacities, splitByCapacities } from './lanes';
import type { LaneCountInput } from './lanes';
import type { ArrangePhoto, FrameMap } from './types';

/** Allowed range of `sizePercent` (share of the content width/height for the centre box). */
export const CENTER_SIZE_PERCENT_MIN = 10;
export const CENTER_SIZE_PERCENT_MAX = 100;

/** `sizePercent` used when the setting is not a number (same as the collage default). */
const FALLBACK_SIZE_PERCENT = 50;

const PERCENT = 100;

/** Smallest fixed lane count (0 = the lane stays empty). */
const MIN_FIXED_LANE_COUNT = 0;

/** A lane side at or below this size (mm) counts as 0; protects against floating-point noise. */
const LANE_EPSILON_MM = 1e-6;

/** Width and height in mm. */
interface Size {
  width: number;
  height: number;
}

/**
 * The free rectangles around the centre frame. A rectangle with a side ≤ 0 is unusable.
 * The middle lane consists of the `left` and `right` side of the centre frame.
 */
interface CenterLanes {
  top: Rect;
  left: Rect;
  right: Rect;
  bottom: Rect;
}

/**
 * Arranges the photos around a centre photo on the content area (page minus margin).
 *
 * - Centre photo: `centerPhotoId` if it is in `photos`, else the first photo. Its frame keeps the image
 *   aspect, fits a box of `sizePercent`% of the content width × height (clamped to 10..100), is centred in
 *   the content, has a full crop and the highest z.
 * - Lanes: top and bottom span the content width; the middle lane is the left plus the right side of the
 *   centre frame (height of the centre frame). Each lane keeps the gap to the centre frame. A lane with a
 *   side ≤ 0 is unusable (for the middle lane: if one side is unusable).
 * - Counts: `topCount`, `middleCount`, `bottomCount` (`null` or non-finite = auto; else rounded down,
 *   at least 0). The photos not taken by fixed counts are distributed over the usable auto lanes by lane
 *   area (see `laneCapacities`). The middle count is split left = ceil(m / 2), right = floor(m / 2).
 * - The other photos keep their order and fill the lanes in the order top, middle left, middle right,
 *   bottom. Top/bottom are one justified row, each middle side one justified column, with cover crops.
 * - Photos that do not fit (beyond the total capacity) are placed beside the page with the width of the
 *   centre frame.
 * - z: the other photos count up from 0 in their order, the centre photo gets the highest z.
 *
 * @param photos photos in arrangement order (the caller sorts by id)
 */
export function arrangeCenter(
  photos: readonly ArrangePhoto[],
  page: PageSize,
  center: CenterSettings,
): FrameMap {
  const frames: FrameMap = new Map();
  if (photos.length === 0) {
    return frames;
  }
  const content = contentRect(page, center.marginMm);
  const gap = nonNegative(center.gapMm);
  const centrePhoto = pickCentrePhoto(photos, center.centerPhotoId);
  const others = photos.filter((photo) => photo !== centrePhoto);
  const centre = centreFrameRect(photoAspect(centrePhoto), content, center.sizePercent);
  const lanes = centerLanes(content, centre, gap);
  const lines = fillOrder(lanes);
  const { groups, rest } = splitByCapacities(others, lineCapacities(others.length, lanes, center));

  let z = 0;
  groups.forEach((group, index) => {
    addFrames(frames, justifiedLineFrames(lines[index], group, gap, z));
    z += group.length;
  });
  addFrames(frames, placeBesidePage(rest, page, centre.width, z));
  frames.set(centrePhoto.id, fullFrame(centre, others.length));
  return frames;
}

/**
 * Id of the photo that the center mode puts in the middle: `centerPhotoId` if a photo with this id is in
 * `photos`, else the smallest photo id (the first photo in import order). `null` for an empty list.
 * The order of `photos` does not matter.
 */
export function resolveCentrePhotoId(
  photos: readonly ArrangePhoto[],
  centerPhotoId: number | null,
): number | null {
  if (photos.some((photo) => photo.id === centerPhotoId)) {
    return centerPhotoId;
  }
  return photos.reduce<number | null>(
    (smallest, photo) => (smallest === null ? photo.id : Math.min(smallest, photo.id)),
    null,
  );
}

/** The centre photo (see `resolveCentrePhotoId`); `photos` must not be empty. */
function pickCentrePhoto(
  photos: readonly ArrangePhoto[],
  centerPhotoId: number | null,
): ArrangePhoto {
  const id = resolveCentrePhotoId(photos, centerPhotoId);
  return photos.find((photo) => photo.id === id) ?? photos[0];
}

/** Centre frame: largest rectangle with the image aspect inside the centre box, centred in the content. */
function centreFrameRect(aspect: number, content: Rect, sizePercent: number): Rect {
  const share =
    clamp(sizePercent, CENTER_SIZE_PERCENT_MIN, CENTER_SIZE_PERCENT_MAX, FALLBACK_SIZE_PERCENT) /
    PERCENT;
  const size = fitAspect(aspect, content.width * share, content.height * share);
  return {
    x: content.x + (content.width - size.width) / 2,
    y: content.y + (content.height - size.height) / 2,
    ...size,
  };
}

/** Largest size with the given aspect that fits in `maxWidth × maxHeight` (0 × 0 for an empty box). */
function fitAspect(aspect: number, maxWidth: number, maxHeight: number): Size {
  return aspect > maxWidth / maxHeight
    ? { width: maxWidth, height: maxWidth / aspect }
    : { width: maxHeight * aspect, height: maxHeight };
}

/** The free rectangles around the centre frame, each reduced by the gap towards the centre frame. */
function centerLanes(content: Rect, centre: Rect, gap: number): CenterLanes {
  return {
    top: {
      x: content.x,
      y: content.y,
      width: content.width,
      height: centre.y - content.y - gap,
    },
    left: {
      x: content.x,
      y: centre.y,
      width: centre.x - content.x - gap,
      height: centre.height,
    },
    right: {
      x: rectRight(centre) + gap,
      y: centre.y,
      width: rectRight(content) - rectRight(centre) - gap,
      height: centre.height,
    },
    bottom: {
      x: content.x,
      y: rectBottom(centre) + gap,
      width: content.width,
      height: rectBottom(content) - rectBottom(centre) - gap,
    },
  };
}

/** The lanes as justified lines in fill order: top row, left column, right column, bottom row. */
function fillOrder(lanes: CenterLanes): Line[] {
  return [
    { rect: lanes.top, direction: 'row' },
    { rect: lanes.left, direction: 'column' },
    { rect: lanes.right, direction: 'column' },
    { rect: lanes.bottom, direction: 'row' },
  ];
}

/**
 * Photo capacity of each line in fill order (top, left, right, bottom) for `photoCount` photos.
 * The middle lane capacity is split left = ceil(m / 2), right = floor(m / 2).
 */
function lineCapacities(photoCount: number, lanes: CenterLanes, center: CenterSettings): number[] {
  const [top, middle, bottom] = laneCapacities(photoCount, [
    laneCountInput(center.topCount, [lanes.top]),
    laneCountInput(center.middleCount, [lanes.left, lanes.right]),
    laneCountInput(center.bottomCount, [lanes.bottom]),
  ]);
  return [top, Math.ceil(middle / 2), Math.floor(middle / 2), bottom];
}

/** Count input of a lane made of the given rectangles (usable only if all rectangles are usable). */
function laneCountInput(count: number | null, rects: readonly Rect[]): LaneCountInput {
  const usable = rects.every(isUsableRect);
  return {
    fixedCount: optionalCount(count, MIN_FIXED_LANE_COUNT),
    area: usable ? sum(rects.map(rectArea)) : 0,
    usable,
  };
}

/** True if both sides of the rectangle are larger than 0. */
function isUsableRect(rect: Rect): boolean {
  return rect.width > LANE_EPSILON_MM && rect.height > LANE_EPSILON_MM;
}

/** Copies all entries of `source` into `target`. */
function addFrames(target: FrameMap, source: FrameMap): void {
  source.forEach((props, id) => target.set(id, props));
}
