// Internal helpers that turn rectangles into photo frames (`PhotoProps`). Shared by all strategies.
import type { NormalizedRect, PhotoProps } from '../../../core/models/photo';
import { coverCrop, fullCrop, imageAspect } from '../geometry/crop';
import { frameSide } from '../geometry/frame-size';
import type { Rect } from '../geometry/rect';
import { inheritedBorder } from '../photo-border';
import type { ArrangePhoto } from './types';

/** Re-exported for the strategies; defined in `geometry/frame-size.ts` (shared with the editor transforms). */
export { MIN_FRAME_SIZE_MM } from '../geometry/frame-size';

/** Arranged frames are not rotated. */
const NO_ROTATION_DEG = 0;

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
