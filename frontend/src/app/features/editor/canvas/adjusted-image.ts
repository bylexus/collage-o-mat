// Adjusted copy of a photo (brightness, contrast, tint). Plain module without Angular.
import type { PhotoAdjust } from '../../../core/models/photo';

/** Luminance weights of R, G and B (Rec. 709), applied to 0..255 channel values. */
const LUMA_R = 0.2126 / 255;
const LUMA_G = 0.7152 / 255;
const LUMA_B = 0.0722 / 255;

/** True if the adjustment shows the original image (missing, `null`, or all neutral values). */
export function isNeutralAdjust(adjust: PhotoAdjust | null | undefined): boolean {
  return !adjust || (adjust.brightness === 0 && adjust.contrast === 0 && adjust.tintStrength === 0);
}

/**
 * Builds an offscreen canvas of the source size (`naturalWidth × naturalHeight`) with the
 * adjusted pixels of `image`, in this order:
 * 1. brightness: `v × (1 + brightness / 100)`, clamped to 0..255;
 * 2. contrast: `(v − 128) × (1 + contrast / 100) + 128`, clamped to 0..255;
 * 3. tint (skipped at strength 0): luminance `L` (0..1) mapped black → tint colour → white
 *    (`L ≤ 0.5`: `tint × 2L`, else `tint + (255 − tint) × (2L − 1)`), mixed with the pixel by
 *    `tintStrength / 100`.
 *
 * Alpha is kept. The copy has the source size, so a crop in source pixels applies to it unchanged.
 * A tint colour that is not `#rrggbb` gives no tint.
 */
export function adjustedImage(image: HTMLImageElement, adjust: PhotoAdjust): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return canvas;
  }
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const levels = toneTable(adjust.brightness, adjust.contrast);
  const tint = adjust.tintStrength > 0 ? parseHexColor(adjust.tintColor) : null;
  const strength = adjust.tintStrength / 100;
  for (let i = 0; i < data.length; i += 4) {
    const r = levels[data[i]];
    const g = levels[data[i + 1]];
    const b = levels[data[i + 2]];
    if (!tint) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      continue;
    }
    const twoL = 2 * (LUMA_R * r + LUMA_G * g + LUMA_B * b);
    // The Uint8ClampedArray rounds and clamps the written values.
    data[i] = r + (tintChannel(tint[0], twoL) - r) * strength;
    data[i + 1] = g + (tintChannel(tint[1], twoL) - g) * strength;
    data[i + 2] = b + (tintChannel(tint[2], twoL) - b) * strength;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Brightness and contrast for each channel value 0..255 (one table for all pixels), each step
 * clamped to 0..255.
 */
function toneTable(brightness: number, contrast: number): Float32Array {
  const brightnessFactor = 1 + brightness / 100;
  const contrastFactor = 1 + contrast / 100;
  const table = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const bright = clampChannel(v * brightnessFactor);
    table[v] = clampChannel((bright - 128) * contrastFactor + 128);
  }
  return table;
}

/** Tinted channel value for twice the luminance (`2L`, 0..2): black → tint → white. */
function tintChannel(tint: number, twoL: number): number {
  return twoL <= 1 ? tint * twoL : tint + (255 - tint) * (twoL - 1);
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value));
}

/** R, G, B (0..255) of a `#rrggbb` colour, or `null` if it has another format. */
function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) {
    return null;
  }
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}
