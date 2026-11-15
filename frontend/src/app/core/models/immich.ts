/** DTOs of the Immich proxy routes `/api/connectors/{id}/immich/...`. */

/** Album as returned by `GET .../immich/albums`. */
export interface ImmichAlbum {
  id: string;
  name: string;
  /** Number of assets in the album (all types, also videos). */
  assetCount: number;
  /** Asset id of the album cover; null if the album has none. */
  thumbnailAssetId: string | null;
}

/** Image asset of an album. */
export interface ImmichAsset {
  id: string;
  fileName: string;
  width: number;
  height: number;
  /** MIME type of the original file in Immich (e.g. `image/jpeg`); may be an empty string. */
  mimeType: string;
}

/** One page of `GET .../immich/albums/{albumId}/assets?page=N` (images only). */
export interface ImmichAssetPage {
  items: ImmichAsset[];
  /** Number of the next page, or `null` if this is the last page. */
  nextPage: number | null;
}

/** URL of the small thumbnail of an Immich asset, proxied by the backend (usable as `<img src>`). */
export function immichThumbnailUrl(connectorId: number, assetId: string): string {
  return `/api/connectors/${connectorId}/immich/assets/${encodeURIComponent(assetId)}/thumbnail`;
}
