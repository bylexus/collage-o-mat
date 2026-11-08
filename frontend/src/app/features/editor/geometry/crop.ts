// Crop math in normalized image coordinates (0..1). Pure functions: no Angular, no DOM.
import type { NormalizedRect } from '../../../core/models/photo';
import { clamp, isPositiveFinite } from './numbers';

/** Centre of the image in normalized coordinates. */
const IMAGE_CENTER: Readonly<{ x: number; y: number }> = { x: 0.5, y: 0.5 };

/** The whole image. */
export function fullCrop(): NormalizedRect {
  return { x: 0, y: 0, width: 1, height: 1 };
}

/**
 * Largest crop with the frame aspect ("cover"), centred on `center` (normalized, default the image centre)
 * and clamped inside the image. A non-positive or invalid aspect gives the full crop.
 * @param imageAspect source image width / height
 * @param frameAspect frame width / height
 */
export function coverCrop(
  imageAspect: number,
  frameAspect: number,
  center: { x: number; y: number } = IMAGE_CENTER,
): NormalizedRect {
  if (!isPositiveFinite(imageAspect) || !isPositiveFinite(frameAspect)) {
    return fullCrop();
  }
  const imageIsWider = imageAspect > frameAspect;
  const width = imageIsWider ? frameAspect / imageAspect : 1;
  const height = imageIsWider ? 1 : imageAspect / frameAspect;
  return {
    x: centredStart(center.x, width, IMAGE_CENTER.x),
    y: centredStart(center.y, height, IMAGE_CENTER.y),
    width,
    height,
  };
}

/**
 * Start of a crop side of length `size` (0..1) centred on `centre`, clamped so the side stays inside 0..1.
 * A non-finite centre uses `fallbackCentre`.
 */
function centredStart(centre: number, size: number, fallbackCentre: number): number {
  const safeCentre = Number.isFinite(centre) ? centre : fallbackCentre;
  return clamp(safeCentre - size / 2, 0, 1 - size);
}
