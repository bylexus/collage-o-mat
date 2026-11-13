// Swap of the frames of two photos. Pure function: no Angular, no DOM.
import type { NormalizedRect, PhotoProps } from '../../core/models/photo';
import { coverCrop, imageAspect } from './geometry/crop';
import type { ImageSize } from './geometry/transform';

/** A placed photo: its props and the pixel size of its image. */
export interface FramedPhoto {
  props: PhotoProps;
  image: ImageSize;
}

/**
 * Swaps the places of two photos: each photo gets the frame of the other (centre, size, rotation,
 * z). Its crop is the largest cover crop of its own image for the new frame, centred on the centre of
 * its current crop and clamped inside the image. The border stays with the photo.
 * Returns the new props of `a` and of `b`.
 */
export function swapFrames(a: FramedPhoto, b: FramedPhoto): [PhotoProps, PhotoProps] {
  return [inFrameOf(a, b.props), inFrameOf(b, a.props)];
}

/**
 * `photo` moved into the frame of `frame`, with a maximal cover crop for the new frame centred on the
 * centre of the photo's current crop (clamped inside the image).
 */
function inFrameOf(photo: FramedPhoto, frame: PhotoProps): PhotoProps {
  const { cxMm, cyMm, widthMm, heightMm, rotationDeg, z } = frame;
  return {
    ...photo.props,
    cxMm,
    cyMm,
    widthMm,
    heightMm,
    rotationDeg,
    z,
    crop: coverCrop(
      imageAspect(photo.image.widthPx, photo.image.heightPx),
      widthMm / heightMm,
      centreOf(photo.props.crop),
    ),
  };
}

/** Centre of a crop in normalized image coordinates. */
function centreOf(crop: NormalizedRect): { x: number; y: number } {
  return { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 };
}
