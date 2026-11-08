// Internal helpers that turn rectangles into photo frames (`PhotoProps`). Shared by all strategies.
import type { NormalizedRect, PhotoBorder, PhotoProps } from '../../../core/models/photo';
import { coverCrop, fullCrop } from '../geometry/crop';
import { isPositiveFinite } from '../geometry/numbers';
import type { Rect } from '../geometry/rect';
import type { ArrangePhoto } from './types';

/** Smallest frame side in mm; protects against zero or negative sizes when the content area is too small. */
export const MIN_FRAME_SIZE_MM = 1;

/** Aspect used for a photo with an invalid pixel size. */
const FALLBACK_ASPECT = 1;

/** Arranged frames are not rotated. */
const NO_ROTATION_DEG = 0;

/** Image aspect (width / height) of a photo; `FALLBACK_ASPECT` if the pixel size is invalid. */
export function photoAspect(photo: ArrangePhoto): number {
  return isPositiveFinite(photo.widthPx) && isPositiveFinite(photo.heightPx)
    ? photo.widthPx / photo.heightPx
    : FALLBACK_ASPECT;
}

/** Frame that fills `rect` with a centred cover crop of the photo. */
export function coverFrame(photo: ArrangePhoto, rect: Rect, z: number): PhotoProps {
  const width = frameSide(rect.width);
  const height = frameSide(rect.height);
  return frameProps(rect, width, height, coverCrop(photoAspect(photo), width / height), z);
}

/** Frame that fills `rect` with the whole image (`rect` must already have the image aspect). */
export function fullFrame(rect: Rect, z: number): PhotoProps {
  return frameProps(rect, frameSide(rect.width), frameSide(rect.height), fullCrop(), z);
}

/** Border that uses the collage `defaultBorder` (a new object per frame). */
function inheritedBorder(): PhotoBorder {
  return { widthMm: null, color: null };
}

/** A frame side of at least `MIN_FRAME_SIZE_MM` (also for NaN). */
function frameSide(size: number): number {
  return Number.isFinite(size) ? Math.max(MIN_FRAME_SIZE_MM, size) : MIN_FRAME_SIZE_MM;
}

/** Props of a frame centred on the centre of `rect` with the given (already safe) size. */
function frameProps(
  rect: Rect,
  widthMm: number,
  heightMm: number,
  crop: NormalizedRect,
  z: number,
): PhotoProps {
  return {
    cxMm: rect.x + rect.width / 2,
    cyMm: rect.y + rect.height / 2,
    widthMm,
    heightMm,
    rotationDeg: NO_ROTATION_DEG,
    z,
    crop,
    border: inheritedBorder(),
  };
}
