// Frame resize and crop pan/zoom math. Pure functions: no Angular, no DOM, no Konva.
import type { NormalizedRect, PhotoProps } from '../../../core/models/photo';
import { coverCrop, imageAspect } from './crop';
import { frameSide } from './frame-size';
import { clamp, finiteOr, isPositiveFinite } from './numbers';

/** Position, size and rotation of a frame (mm, degrees). Centre coordinates like `PhotoProps`. */
export interface FrameBox {
  cxMm: number;
  cyMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
}

/** Pixel size of the source image. */
export interface ImageSize {
  widthPx: number;
  heightPx: number;
}

/** A point in normalized coordinates (0..1). */
interface NormalizedPoint {
  x: number;
  y: number;
}

/**
 * Smallest crop side in normalized image coordinates, applied to the larger normalized side of the crop
 * (0.05 = 5 % of the image side, i.e. at most 20× zoom).
 */
export const MIN_CROP_SIZE = 0.05;

/** Largest crop side in normalized image coordinates (the whole image side). */
const MAX_CROP_SIZE = 1;

/** Degrees in a full turn. */
const FULL_TURN_DEG = 360;

/** Upper bound of a normalized rotation; the range is (-180, 180]. */
const HALF_TURN_DEG = 180;

/** Centre of the frame in normalized frame coordinates (default zoom anchor). */
const FRAME_CENTER: Readonly<NormalizedPoint> = { x: 0.5, y: 0.5 };

/**
 * Applies a moved/rotated/resized frame to the props.
 * - `keepAspect` (corner handles): the crop stays the same.
 * - otherwise (edge handles, frame aspect changed): the crop is recomputed as "cover" around the current
 *   crop centre, so the frame stays filled.
 * z and border are kept.
 *
 * Guards: non-finite box values keep the current props value; sides are at least `MIN_FRAME_SIZE_MM`; the
 * rotation is normalized to (-180, 180]. If a side had to be enlarged to the minimum, the aspect changed, so
 * the crop is recomputed even with `keepAspect` (the image is never distorted).
 */
export function applyFrameBox(
  props: PhotoProps,
  box: FrameBox,
  image: ImageSize,
  keepAspect: boolean,
): PhotoProps {
  const requestedWidth = finiteOr(box.widthMm, props.widthMm);
  const requestedHeight = finiteOr(box.heightMm, props.heightMm);
  const widthMm = frameSide(requestedWidth);
  const heightMm = frameSide(requestedHeight);
  const sizeWasGuarded = widthMm !== requestedWidth || heightMm !== requestedHeight;
  const crop =
    keepAspect && !sizeWasGuarded
      ? props.crop
      : coverCrop(
          imageAspect(image.widthPx, image.heightPx),
          widthMm / heightMm,
          cropCentre(props.crop),
        );
  return {
    ...props,
    cxMm: finiteOr(box.cxMm, props.cxMm),
    cyMm: finiteOr(box.cyMm, props.cyMm),
    widthMm,
    heightMm,
    rotationDeg: normalizeRotationDeg(finiteOr(box.rotationDeg, props.rotationDeg)),
    crop,
  };
}

/**
 * Crop mode, drag: moves the image inside the frame by a delta in frame-local mm (positive dx = image moves
 * right, so the crop moves left). The crop keeps its size and stays inside the image (0..1).
 *
 * A non-finite delta counts as 0. An invalid frame size or crop size returns `crop` unchanged (same object).
 */
export function panCrop(
  crop: NormalizedRect,
  dxMm: number,
  dyMm: number,
  frameWidthMm: number,
  frameHeightMm: number,
): NormalizedRect {
  if (!isPositiveFinite(frameWidthMm) || !isPositiveFinite(frameHeightMm) || !hasValidSize(crop)) {
    return crop;
  }
  const dxCrop = (finiteOr(dxMm, 0) / frameWidthMm) * crop.width;
  const dyCrop = (finiteOr(dyMm, 0) / frameHeightMm) * crop.height;
  return {
    x: cropStart(crop.x - dxCrop, crop.width, crop.x),
    y: cropStart(crop.y - dyCrop, crop.height, crop.y),
    width: crop.width,
    height: crop.height,
  };
}

/**
 * Crop mode, zoom: scales the crop by `1 / factor` (factor > 1 = zoom in) around `anchor` (normalized point
 * in the frame, 0..1; default the frame centre). The crop keeps its aspect, stays inside the image and is
 * never larger than the cover crop nor smaller than `MIN_CROP_SIZE` of the image.
 *
 * - The image point under `anchor` stays under it, unless the size limits or the image edges clamp the crop.
 * - The aspect is kept in normalized coordinates (`width / height` constant); the largest crop with that
 *   aspect inside 0..1 has its larger side = 1, which is the cover crop size for the frame.
 * - A non-positive or non-finite factor, or an invalid crop size, returns `crop` unchanged (same object).
 *   A non-finite anchor coordinate uses the frame centre; the anchor is limited to 0..1.
 */
export function zoomCrop(
  crop: NormalizedRect,
  factor: number,
  anchor: { x: number; y: number } = { x: 0.5, y: 0.5 },
): NormalizedRect {
  if (!isPositiveFinite(factor) || !hasValidSize(crop)) {
    return crop;
  }
  const largerSide = Math.max(crop.width, crop.height);
  const scale = clamp(largerSide / factor, MIN_CROP_SIZE, MAX_CROP_SIZE) / largerSide;
  const width = crop.width * scale;
  const height = crop.height * scale;
  const anchorX = clamp(anchor.x, 0, 1, FRAME_CENTER.x);
  const anchorY = clamp(anchor.y, 0, 1, FRAME_CENTER.y);
  return {
    x: cropStart(crop.x + anchorX * (crop.width - width), width, crop.x),
    y: cropStart(crop.y + anchorY * (crop.height - height), height, crop.y),
    width,
    height,
  };
}

/** Rotation in degrees normalized to (-180, 180]; a non-finite value gives 0. */
export function normalizeRotationDeg(rotationDeg: number): number {
  if (!Number.isFinite(rotationDeg)) {
    return 0;
  }
  const positive = ((rotationDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
  // `+ 0` turns a possible -0 into 0.
  return (positive > HALF_TURN_DEG ? positive - FULL_TURN_DEG : positive) + 0;
}

/** Centre of the crop in normalized image coordinates. */
function cropCentre(crop: NormalizedRect): NormalizedPoint {
  return { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 };
}

/** True if both crop sides are finite and greater than 0. */
function hasValidSize(crop: NormalizedRect): boolean {
  return isPositiveFinite(crop.width) && isPositiveFinite(crop.height);
}

/**
 * Start of a crop side of length `size`, limited so the side stays inside 0..1. A non-finite `start` uses
 * `fallback` (also limited).
 */
function cropStart(start: number, size: number, fallback: number): number {
  const maxStart = Math.max(0, 1 - size);
  return clamp(finiteOr(start, fallback), 0, maxStart);
}
