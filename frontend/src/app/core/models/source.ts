/**
 * Neutral DTO shapes of photo sources (Immich, Synology), used by the shared import components
 * (`album-list`, `asset-grid`). The type-specific models extend them with their own fields.
 */

/** Album of a photo source. */
export interface SourceAlbum {
  id: string;
  name: string;
  /** Number of items in the album as reported by the source (may include videos). */
  assetCount: number;
}

/** Image asset of a photo source. */
export interface SourceAsset {
  id: string;
  fileName: string;
  /** Displayed size in px; 0 if unknown. */
  width: number;
  height: number;
  /** MIME type of the original file (e.g. `image/jpeg`); may be an empty string. */
  mimeType: string;
}

/** One page of assets; `T` is the type-specific asset. */
export interface SourceAssetPage<T extends SourceAsset = SourceAsset> {
  items: T[];
  /** Number of the next page, or `null` if this is the last page. */
  nextPage: number | null;
}
