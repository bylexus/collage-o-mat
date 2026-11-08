// One justified row or column of photos with cover crops. Pure, no Angular.
import { sum } from '../geometry/numbers';
import type { Rect } from '../geometry/rect';
import { coverFrame, photoAspect } from './frame';
import type { ArrangePhoto, FrameMap } from './types';

/** `row`: photos side by side, left to right; `column`: photos one below the other, top to bottom. */
export type LineDirection = 'row' | 'column';

/** A rectangle that is filled with one justified row or column of photos. */
export interface Line {
  rect: Rect;
  direction: LineDirection;
}

/**
 * Cover frames for the photos of one justified line, in the given order:
 * - the side along the line is proportional to the natural image size along the line (row: width ∝ image
 *   aspect; column: height ∝ 1 / image aspect), and all sides plus the gaps between them fill the line;
 * - across the line, each frame fills the line;
 * - z counts up from `zStart`.
 *
 * Few photos still span the whole line. If the gaps alone are longer than the line, the frames get the
 * minimal frame size (they can then overlap).
 */
export function justifiedLineFrames(
  line: Line,
  photos: readonly ArrangePhoto[],
  gap: number,
  zStart: number,
): FrameMap {
  const frames: FrameMap = new Map();
  const weights = photos.map((photo) => naturalLength(photo, line.direction));
  let offset = 0;
  justify(weights, lineLength(line), gap).forEach((size, index) => {
    const photo = photos[index];
    frames.set(photo.id, coverFrame(photo, lineCell(line, offset, size), zStart + index));
    offset += size + gap;
  });
  return frames;
}

/** Relative size of the photo along the line (image height = 1). */
function naturalLength(photo: ArrangePhoto, direction: LineDirection): number {
  const aspect = photoAspect(photo);
  return direction === 'row' ? aspect : 1 / aspect;
}

/** Length of the line in its direction. */
function lineLength(line: Line): number {
  return line.direction === 'row' ? line.rect.width : line.rect.height;
}

/**
 * Sizes proportional to `weights` so that the sizes plus the gaps between them equal `length`.
 * If the gaps alone are longer than `length`, the sizes are 0.
 */
function justify(weights: readonly number[], length: number, gap: number): number[] {
  const available = Math.max(0, length - (weights.length - 1) * gap);
  const weightSum = sum(weights);
  return weights.map((weight) => (available * weight) / weightSum);
}

/** Cell at `offset` along the line with `size` along the line; across the line it fills the line. */
function lineCell(line: Line, offset: number, size: number): Rect {
  const { x, y, width, height } = line.rect;
  return line.direction === 'row'
    ? { x: x + offset, y, width: size, height }
    : { x, y: y + offset, width, height: size };
}
