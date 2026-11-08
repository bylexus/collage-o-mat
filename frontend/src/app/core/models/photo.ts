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
  /** The `props` JSON document (frame, crop, border); typed in step 6. `{}` until arranged. */
  props: Record<string, unknown>;
}

/** Body of `POST /api/collages/{id}/import`. */
export interface ImportRequest {
  connectorId: number;
  assetIds: string[];
}

/** Result of `POST /api/collages/{id}/import`. */
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
