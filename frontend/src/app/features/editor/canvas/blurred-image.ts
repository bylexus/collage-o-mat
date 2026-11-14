// Blurred copy of the bg photo for the page background. Plain module without Angular.
import { Blur } from 'konva/lib/filters/Blur';
import type { FilterFunction } from 'konva/lib/Node';
import type { PageSize } from '../../../core/models/collage';
import type { NormalizedRect } from '../../../core/models/photo';

/**
 * Blur radius in working px that the working resolution aims for. A larger radius gives a smoother
 * result but a larger (slower) copy; the copy is scaled up to the page, the strong blur hides the
 * low resolution.
 */
const TARGET_RADIUS_PX = 16;

/** Upper limit of the long side of the working canvas in px. */
const MAX_LONG_SIDE_PX = 2048;

/** Largest radius of the Konva stack blur (`MAX_RADIUS` in `konva/lib/filters/Blur`). */
const MAX_BLUR_RADIUS_PX = 180;

/**
 * Builds an offscreen canvas with the cropped part of `image` (normalized `crop`, e.g. the cover
 * crop) blurred by `blurMm` in page space. The working resolution (px per mm) comes from the
 * radius (aim: `TARGET_RADIUS_PX`), capped by `MAX_LONG_SIDE_PX` and the source crop resolution;
 * so the blur looks the same at each zoom and export DPI. The stack blur clamps the edge pixels:
 * the copy has no transparent border. Draw it scaled to the page size, without a crop.
 */
export function blurredImage(
  image: HTMLImageElement,
  crop: NormalizedRect,
  page: PageSize,
  blurMm: number,
): HTMLCanvasElement {
  const cropWidthPx = crop.width * image.naturalWidth;
  const cropHeightPx = crop.height * image.naturalHeight;
  const pxPerMm = Math.min(
    TARGET_RADIUS_PX / blurMm,
    MAX_LONG_SIDE_PX / Math.max(page.widthMm, page.heightMm),
    cropWidthPx / page.widthMm,
    cropHeightPx / page.heightMm,
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(page.widthMm * pxPerMm));
  canvas.height = Math.max(1, Math.round(page.heightMm * pxPerMm));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return canvas;
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    crop.x * image.naturalWidth,
    crop.y * image.naturalHeight,
    cropWidthPx,
    cropHeightPx,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const radius = Math.min(MAX_BLUR_RADIUS_PX, Math.max(1, Math.round(blurMm * pxPerMm)));
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  // Konva's filter reads only `this.blurRadius()`; the radius stays an integer within its limit.
  (Blur as FilterFunction).call({ blurRadius: () => radius } as never, imageData);
  context.putImageData(imageData, 0, 0);
  return canvas;
}
