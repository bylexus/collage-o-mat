/** DTOs of the Immich proxy routes `/api/connectors/{id}/immich/...`. */

import { SourceAlbum, SourceAsset, SourceAssetPage } from './source';

/** Album as returned by `GET .../immich/albums`. `assetCount` counts all types, also videos. */
export interface ImmichAlbum extends SourceAlbum {
  /** Asset id of the album cover; null if the album has none. */
  thumbnailAssetId: string | null;
}

/** Image asset of an album (`mimeType` is the MIME type of the original file in Immich). */
export type ImmichAsset = SourceAsset;

/** One page of `GET .../immich/albums/{albumId}/assets?page=N` (images only). */
export type ImmichAssetPage = SourceAssetPage<ImmichAsset>;

/** URL of the small thumbnail of an Immich asset, proxied by the backend (usable as `<img src>`). */
export function immichThumbnailUrl(connectorId: number, assetId: string): string {
  return `/api/connectors/${connectorId}/immich/assets/${encodeURIComponent(assetId)}/thumbnail`;
}
