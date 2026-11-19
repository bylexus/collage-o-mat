// Internal helpers that turn rectangles into photo frames (`PhotoProps`). Shared by all strategies.
import type { NormalizedRect, PhotoProps } from '../../../core/models/photo';
import { coverCrop, fullCrop, imageAspect } from '../geometry/crop';
import { frameSide } from '../geometry/frame-size';
import type { Rect } from '../geometry/rect';
import type { ArrangePhoto } from './types';

/** Re-exported for the strategies; defined in `geometry/frame-size.ts` (shared with the editor transforms). */
export { MIN_FRAME_SIZE_MM } from '../geometry/frame-size';

/** Frames of `coverFrame` and `fullFrame` are not rotated. */
const NO_ROTATION_DEG = 0;

/** How a frame shows its photo: the whole image or a centred cover crop. */
export type FrameCrop = 'full' | 'cover';

/** A point on the page in mm. */
export interface Point {
  x: number;
  y: number;
}

/** Image aspect (width / height) of a photo; a fallback aspect if the pixel size is invalid. */
export function photoAspect(photo: ArrangePhoto): number {
  return imageAspect(photo.widthPx, photo.heightPx);
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

/**
 * Frame of the given size centred on `centre` and rotated by `rotationDeg` around it. `full` shows
 * the whole image (the size must already have the image aspect), `cover` a centred cover crop.
 * Sides below `MIN_FRAME_SIZE_MM` or invalid sides are made safe with `frameSide`.
 */
export function rotatedFrame(
  photo: ArrangePhoto,
  centre: Point,
  widthMm: number,
  heightMm: number,
  rotationDeg: number,
  crop: FrameCrop,
  z: number,
): PhotoProps {
  const width = frameSide(widthMm);
  const height = frameSide(heightMm);
  const rect: Rect = { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
  const normalizedCrop =
    crop === 'full' ? fullCrop() : coverCrop(photoAspect(photo), width / height);
  return frameProps(rect, width, height, normalizedCrop, z, rotationDeg);
}

/** Props of a frame centred on the centre of `rect` with the given (already safe) size. */
function frameProps(
  rect: Rect,
  widthMm: number,
  heightMm: number,
  crop: NormalizedRect,
  z: number,
  rotationDeg = NO_ROTATION_DEG,
): PhotoProps {
  return {
    cxMm: rect.x + rect.width / 2,
    cyMm: rect.y + rect.height / 2,
    widthMm,
    heightMm,
    rotationDeg,
    z,
    crop,
    border: null,
  };
}
