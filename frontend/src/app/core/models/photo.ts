/** Photo DTOs of a collage and the import from a connector. */

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
  /** Frame, crop and border on the page; `{}` until the photo is arranged (see `isPlaced`). */
  props: PhotoProps | UnplacedProps;
}

/** Rectangle in normalized image coordinates (0..1 of the source image width/height). */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-photo border override; `null` values use the collage `defaultBorder`. Drawn inside the frame. */
export interface PhotoBorder {
  widthMm: number | null;
  color: string | null;
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
  border: PhotoBorder;
}

/** `props` of a photo that is not arranged yet. */
export type UnplacedProps = Record<string, never>;

/** True if the photo has a frame on the page (or beside it). */
export function isPlaced(props: PhotoProps | UnplacedProps): props is PhotoProps {
  return typeof (props as Partial<PhotoProps>).widthMm === 'number';
}

/** Body of `POST /api/collages/{id}/import`. */
export interface ImportRequest {
  connectorId: number;
  assetIds: string[];
}

/** Result of `POST /api/collages/{id}/import` and `POST /api/collages/{id}/uploads`. */
export interface ImportResult {
  /** The new photos in import order. */
  photos: Photo[];
  /** Number of assets not imported because they are already in the collage. */
  skipped: number;
}

/** URL of the stored image file of a photo (usable as `<img src>`). */
export function photoFileUrl(collageId: number, photoId: number): string {
  return `/api/collages/${collageId}/photos/${photoId}/file`;
}
