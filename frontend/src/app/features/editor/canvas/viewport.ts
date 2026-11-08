// View math of the editor canvas. Pure, no Angular, no Konva.
import type { PhotoProps } from '../../../core/models/photo';

/** Axis-aligned rectangle. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Point in screen px. */
export interface Point {
  x: number;
  y: number;
}

/** Size of the view in screen px. */
export interface Size {
  width: number;
  height: number;
}

/** Scale and offset of the stage: screen px = world mm × scale + offset. */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

/** Screen px per mm at 100 % zoom (CSS reference pixel: 96 px per inch, 25.4 mm per inch). */
export const PX_PER_MM = 96 / 25.4;
/** Smallest zoom (1 = real size). */
export const MIN_ZOOM = 0.1;
/** Largest zoom (1 = real size). */
export const MAX_ZOOM = 8;
/** Zoom change per wheel delta px: factor = e^(−delta × sensitivity). Tuned for trackpad pinch. */
const WHEEL_ZOOM_SENSITIVITY = 0.01;
/**
 * Largest wheel delta (px) used per event. A mouse wheel notch (~100 px) is limited to this, so
 * one notch zooms by about the factor of a zoom button step instead of a large jump.
 */
const MAX_WHEEL_ZOOM_DELTA_PX = 25;

/** Axis-aligned bounding box of a (rotated) photo frame. */
export function frameBounds(props: PhotoProps): Rect {
  const rad = (props.rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = props.widthMm * cos + props.heightMm * sin;
  const height = props.widthMm * sin + props.heightMm * cos;
  return { x: props.cxMm - width / 2, y: props.cyMm - height / 2, width, height };
}

/** Smallest rectangle that contains all rectangles (at least one is required). */
export function unionRects(first: Rect, ...others: readonly Rect[]): Rect {
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const r of others) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Transform that shows `rect` as large as possible and centred in a view, with a margin in px. The
 * zoom is limited to `MIN_ZOOM`..`MAX_ZOOM`; the rectangle stays centred.
 */
export function fitRect(rect: Rect, view: Size, marginPx: number): ViewTransform {
  const availableWidth = Math.max(1, view.width - 2 * marginPx);
  const availableHeight = Math.max(1, view.height - 2 * marginPx);
  const scale = Math.min(availableWidth / rect.width, availableHeight / rect.height);
  const fit = {
    scale,
    x: (view.width - rect.width * scale) / 2 - rect.x * scale,
    y: (view.height - rect.height * scale) / 2 - rect.y * scale,
  };
  return zoomTo(fit, scale, centreOf(view));
}

/** Zoom (1 = real size) of a stage scale (px per mm). */
export function zoomOfScale(scale: number): number {
  return scale / PX_PER_MM;
}

/** The scale limited to the zoom range `MIN_ZOOM`..`MAX_ZOOM`. */
export function clampScale(scale: number): number {
  return clamp(scale, MIN_ZOOM * PX_PER_MM, MAX_ZOOM * PX_PER_MM);
}

/**
 * Transform with a new scale (limited to the zoom range). The world point under `anchor` (screen
 * px) stays under it.
 */
export function zoomTo(view: ViewTransform, scale: number, anchor: Point): ViewTransform {
  const newScale = clampScale(scale);
  const ratio = newScale / view.scale;
  return {
    scale: newScale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}

/** Transform zoomed by `factor` around `anchor` (screen px); see `zoomTo`. */
export function zoomBy(view: ViewTransform, factor: number, anchor: Point): ViewTransform {
  return zoomTo(view, view.scale * factor, anchor);
}

/** Transform moved by `dx`/`dy` screen px. */
export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { scale: view.scale, x: view.x + dx, y: view.y + dy };
}

/** Transform after a view resize: the world point at the old view centre is at the new centre. */
export function keepCentre(view: ViewTransform, oldSize: Size, newSize: Size): ViewTransform {
  return panBy(view, (newSize.width - oldSize.width) / 2, (newSize.height - oldSize.height) / 2);
}

/** Centre of a view in screen px. */
export function centreOf(size: Size): Point {
  return { x: size.width / 2, y: size.height / 2 };
}

/**
 * Zoom factor of a wheel or trackpad pinch event with the vertical delta `deltaYPx` (px; negative =
 * zoom in). Smooth for the small pinch deltas, limited for mouse wheel notches.
 */
export function wheelZoomFactor(deltaYPx: number): number {
  const delta = clamp(deltaYPx, -MAX_WHEEL_ZOOM_DELTA_PX, MAX_WHEEL_ZOOM_DELTA_PX);
  return Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
