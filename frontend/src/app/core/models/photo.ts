/** Photo DTOs of a collage and the import from a connector. */

import type { BorderSettings } from './collage';
import type { Shadow } from './shadow';

/** Photo of a collage as returned by the API. */
export interface Photo {
  id: number;
  /** Connector the photo was imported from; `null` if the connector is unknown. */
  connectorId: number | null;
  /** Id of the asset in the source system (e.g. the Immich asset id). */
  sourceAssetId: string;
  widthPx: number;
  heightPx: number;
  mimeType: string;
  /** Frame, crop, border and shadow on the page; `{}` until the photo is arranged (see `isPlaced`). */
  props: PhotoProps | UnplacedProps;
}

/** Rectangle in normalized image coordinates (0..1 of the source image width/height). */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Non-destructive image adjustment of one photo, applied in this order: brightness, contrast, tint.
 * The neutral values (brightness 0, contrast 0, tint strength 0) show the original image.
 */
export interface PhotoAdjust {
  /** -100..100; 0 = unchanged. Each channel is multiplied by `1 + brightness / 100`. */
  brightness: number;
  /** -100..100; 0 = unchanged. Each channel is scaled around mid-grey by `1 + contrast / 100`. */
  contrast: number;
  /** Tint colour `#rrggbb`: luminance is mapped black → tint colour → white (`#808080` = greyscale). */
  tintColor: string;
  /** 0..100 % mix of the tinted image with the original; 0 = no tint (the colour is ignored). */
  tintStrength: number;
}

/** The `props` JSON document of a placed photo. All lengths in mm, page origin top-left. */
export interface PhotoProps {
  /** Frame centre (rotation is around the centre). */
  cxMm: number;
  cyMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  /** Stacking order, shared with texts; higher is in front. */
  z: number;
  /** Part of the source image shown in the frame. */
  crop: NormalizedRect;
  /**
   * Own border of the photo (drawn inside the frame). Missing or `null` = the collage
   * `defaultBorder`; an object = a full own border. Photo props are not normalized on load: a value
   * that is no valid `BorderSettings` (e.g. the old format `{ widthMm, color }`) counts as no own
   * border (see `effectiveBorder`).
   */
  border?: BorderSettings | null;
  /**
   * Own drop shadow of the photo. Missing or `null` = the collage `defaultShadow`; an object = a
   * full own shadow (`enabled: false` switches the shadow off for this photo). Optional because
   * photo props are not normalized on load (photos saved before shadows existed have none).
   */
  shadow?: Shadow | null;
  /**
   * Brightness, contrast and tint of the photo. Missing or `null` = no adjustment. Optional because
   * photo props are not normalized on load (photos saved before adjustments existed have none).
   */
  adjust?: PhotoAdjust | null;
}

/** `props` of a photo that is not arranged yet. */
export type UnplacedProps = Record<string, never>;

/** True if the photo has a frame on the page (or beside it). */
export function isPlaced(props: PhotoProps | UnplacedProps): props is PhotoProps {
  return typeof (props as Partial<PhotoProps>).widthMm === 'number';
}

/**
 * Image size of an Immich import: `preview` = the big Immich thumbnail (about 1440 px),
 * `original` = full resolution (re-encoded as JPEG by the backend).
 */
export type ImportSize = 'preview' | 'original';

/** Body of `POST /api/collages/{id}/import`. */
export interface ImportRequest {
  connectorId: number;
  assetIds: string[];
  size: ImportSize;
}

/** Result of `POST /api/collages/{id}/import` and `POST /api/collages/{id}/uploads`. */
export interface ImportResult {
  /** The new photos in import order. */
  photos: Photo[];
  /** Number of assets not imported because they are already in the collage. */
  skipped: number;
  /**
   * Number of photos imported in preview size although the original size was requested (Immich
   * could not deliver a full-size image). Always 0 for uploads.
   */
  previewFallbacks: number;
}

/** URL of the stored image file of a photo (usable as `<img src>`). */
export function photoFileUrl(collageId: number, photoId: number): string {
  return `/api/collages/${collageId}/photos/${photoId}/file`;
}
