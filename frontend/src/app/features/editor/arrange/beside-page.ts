// Places photos unarranged to the right of the page. Re-exported by `arrange.ts`.
import type { PageSize } from '../../../core/models/collage';
import { nonNegative } from '../geometry/numbers';
import { fullFrame, MIN_FRAME_SIZE_MM, photoAspect } from './frame';
import type { ArrangePhoto, FrameMap } from './types';

/** Horizontal distance between the right page edge and the photos beside the page. */
export const BESIDE_PAGE_OFFSET_MM = 10;

/** Vertical offset between two stacked photos beside the page. */
export const BESIDE_PAGE_STACK_OFFSET_MM = 10;

/** Top edge of the first photo beside the page (the page top). */
const BESIDE_PAGE_TOP_MM = 0;

/**
 * Places photos unarranged to the right of the page (x = page width + 10 mm), stacked with 10 mm vertical
 * offset, frame width `widthMm`, image aspect kept, full crop, z starting at `zStart`.
 * Used for grid overflow and for new photos that the user did not want to re-arrange.
 *
 * The stack is a cascade: photo `i` has its top edge at `i × 10 mm` from the page top, so later photos
 * overlap earlier ones and are in front of them (higher z). A non-positive `widthMm` uses the minimal
 * frame size.
 */
export function placeBesidePage(
  photos: readonly ArrangePhoto[],
  page: PageSize,
  widthMm: number,
  zStart: number,
): FrameMap {
  const left = nonNegative(page.widthMm) + BESIDE_PAGE_OFFSET_MM;
  const width = Math.max(MIN_FRAME_SIZE_MM, nonNegative(widthMm));
  const frames: FrameMap = new Map();
  photos.forEach((photo, index) => {
    const rect = {
      x: left,
      y: BESIDE_PAGE_TOP_MM + index * BESIDE_PAGE_STACK_OFFSET_MM,
      width,
      height: width / photoAspect(photo),
    };
    frames.set(photo.id, fullFrame(rect, zStart + index));
  });
  return frames;
}
