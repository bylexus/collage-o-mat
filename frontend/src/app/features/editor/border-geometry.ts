// Geometry of a photo border in its frame. Pure functions: no Angular, no Konva.
import type {
  BorderSettings,
  CornersBorderSettings,
  PolaroidFormat,
} from '../../core/models/collage';
import type { Rect } from './geometry/rect';

/** Size of a Polaroid card and its border on each side, in mm (approximations). */
export interface PolaroidFormatSize {
  cardWidthMm: number;
  cardHeightMm: number;
  sideMm: number;
  topMm: number;
  bottomMm: number;
}

/** Card and border sizes of the Polaroid formats (the image is the rest of the card). */
export const POLAROID_FORMAT_SIZES: Readonly<Record<PolaroidFormat, PolaroidFormatSize>> = {
  p600: { cardWidthMm: 88, cardHeightMm: 107, sideMm: 4.5, topMm: 6, bottomMm: 22 },
  go: { cardWidthMm: 53.9, cardHeightMm: 66.6, sideMm: 3.45, topMm: 4.5, bottomMm: 16.1 },
  spectra: { cardWidthMm: 101, cardHeightMm: 102, sideMm: 4.5, topMm: 6, bottomMm: 23 },
};

/**
 * Gap between the photo edges and the legs of the photo-corner triangles, relative to the (clamped)
 * leg length (not configurable). The triangles move out of the frame by the gap; the photo keeps
 * the full frame.
 */
export const CORNER_GAP_RATIO = 0.025;

/**
 * What `PhotoView` draws for a border, in frame-local mm (origin at the top-left frame corner).
 */
export interface BorderLayout {
  /** Fill colour of a rect of frame size behind the image (the border); `null` = no rect. */
  fill: string | null;
  /** Area inside the border: the image is clipped to it. Can have zero width or height. */
  inner: Rect;
  /** Where the image is drawn (before the clip to `inner`). */
  image: Rect;
  /**
   * False: the stored crop is drawn into `image` as it is (it has the frame aspect). True: only
   * the centred part of the crop with the aspect of `image` is drawn (`coverPart`), so the image is
   * not distorted.
   */
  cover: boolean;
  /** Photo corners drawn on top of the image; `null` for the other types. */
  corners: CornersLayout | null;
}

/** Photo corners of a `corners` border, in frame-local mm. */
export interface CornersLayout {
  color: string;
  /** Leg length of each triangle (already clamped); 0 = nothing to draw. */
  legMm: number;
  /**
   * The four right-angled triangles (top-left, top-right, bottom-right, bottom-left) as flat point
   * lists `[x0, y0, x1, y1, x2, y2]`; the first point is the frame corner moved out by the gap in
   * both directions (e.g. `(-g, -g)`, `g = CORNER_GAP_RATIO × legMm`), the legs lie on the lines `g`
   * outside the frame edges. So the triangles stick out of the frame a little, like an album
   * photo-corner pocket that is a bit larger than the photo.
   */
  triangles: number[][];
}

/**
 * The layout of `border` in a frame of `widthMm` × `heightMm`.
 * - `none`: no fill, the image fills the frame.
 * - `color`: a filled rect of frame size and the frame shrunk by the width (clamped to half the
 *   shorter side); the image keeps the frame size and is clipped to the inner area.
 * - `polaroid`: a card of frame size; the borders are the format borders scaled by
 *   `s = min(frameW / cardW, frameH / cardH)`, the thick border at the bottom of the frame; the
 *   image is cover-fitted into the inner area.
 * - `corners`: no fill, the image fills the frame (as `none`); four triangles at the frame corners,
 *   moved out of the frame by a small gap (see `cornersLayout`).
 */
export function borderLayout(
  border: BorderSettings,
  widthMm: number,
  heightMm: number,
): BorderLayout {
  const frame: Rect = { x: 0, y: 0, width: widthMm, height: heightMm };
  switch (border.type) {
    case 'none':
      return { fill: null, inner: frame, image: frame, cover: false, corners: null };
    case 'color': {
      const width = Math.max(0, Math.min(border.color.widthMm, widthMm / 2, heightMm / 2));
      if (width === 0) {
        return { fill: null, inner: frame, image: frame, cover: false, corners: null };
      }
      return {
        fill: border.color.color,
        inner: { x: width, y: width, width: widthMm - 2 * width, height: heightMm - 2 * width },
        image: frame,
        cover: false,
        corners: null,
      };
    }
    case 'polaroid': {
      const inner = polaroidInner(border.polaroid.format, widthMm, heightMm);
      return { fill: border.polaroid.color, inner, image: inner, cover: true, corners: null };
    }
    case 'corners':
      return {
        fill: null,
        inner: frame,
        image: frame,
        cover: false,
        corners: cornersLayout(border.corners, widthMm, heightMm),
      };
  }
}

/**
 * Leg length in mm of the photo corners in a frame of `widthMm` × `heightMm`: `sizeMm` (mode
 * `fixed`) or `sizePercent` % of the shorter frame side (mode `relative`), clamped to 0 … half the
 * shorter frame side.
 */
export function cornerLegMm(
  corners: CornersBorderSettings,
  widthMm: number,
  heightMm: number,
): number {
  const shorter = Math.max(0, Math.min(widthMm, heightMm));
  const leg = corners.sizeMode === 'fixed' ? corners.sizeMm : (corners.sizePercent / 100) * shorter;
  return Number.isFinite(leg) ? Math.max(0, Math.min(leg, shorter / 2)) : 0;
}

/**
 * The four corner triangles of `corners` in a frame of `widthMm` × `heightMm`: the right-angle
 * corner of each triangle is the frame corner moved out by the gap `g` in both directions, the legs
 * (length `leg`) lie on the lines `g` outside the frame edges.
 */
function cornersLayout(
  corners: CornersBorderSettings,
  widthMm: number,
  heightMm: number,
): CornersLayout {
  const leg = cornerLegMm(corners, widthMm, heightMm);
  const g = CORNER_GAP_RATIO * leg;
  const left = -g;
  const top = -g;
  const right = widthMm + g;
  const bottom = heightMm + g;
  return {
    color: corners.color,
    legMm: leg,
    triangles: [
      [left, top, left + leg, top, left, top + leg],
      [right, top, right, top + leg, right - leg, top],
      [right, bottom, right - leg, bottom, right, bottom - leg],
      [left, bottom, left, bottom - leg, left + leg, bottom],
    ],
  };
}

/** Area inside a Polaroid card of `format` scaled to a frame of `widthMm` × `heightMm`. */
function polaroidInner(format: PolaroidFormat, widthMm: number, heightMm: number): Rect {
  const size = POLAROID_FORMAT_SIZES[format];
  const scale = Math.max(0, Math.min(widthMm / size.cardWidthMm, heightMm / size.cardHeightMm));
  const side = scale * size.sideMm;
  const top = scale * size.topMm;
  const bottom = scale * size.bottomMm;
  return {
    x: side,
    y: top,
    width: Math.max(0, widthMm - 2 * side),
    height: Math.max(0, heightMm - top - bottom),
  };
}

/**
 * The centred part of `crop` (source px) with the aspect `width / height` of the target: the
 * largest such part ("cover"). An invalid aspect gives the crop unchanged.
 */
export function coverPart(crop: Rect, width: number, height: number): Rect {
  const aspect = width / height;
  if (!(aspect > 0) || !Number.isFinite(aspect) || !(crop.width > 0) || !(crop.height > 0)) {
    return crop;
  }
  if (crop.width / crop.height > aspect) {
    const partWidth = crop.height * aspect;
    return {
      x: crop.x + (crop.width - partWidth) / 2,
      y: crop.y,
      width: partWidth,
      height: crop.height,
    };
  }
  const partHeight = crop.width / aspect;
  return {
    x: crop.x,
    y: crop.y + (crop.height - partHeight) / 2,
    width: crop.width,
    height: partHeight,
  };
}
