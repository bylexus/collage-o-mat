/** DTOs of the Synology proxy routes `/api/connectors/{id}/synology/...`. */

import { SourceAlbum, SourceAsset, SourceAssetPage } from './source';

/**
 * Album as returned by `GET .../synology/albums`. `assetCount` counts all types, also videos. The
 * Synology API has no album cover, so `thumbnailAssetId` is always `null`.
 */
export interface SynologyAlbum extends SourceAlbum {
  thumbnailAssetId: null;
}

/**
 * Photo of an album or folder. `mimeType` is derived from the file extension (may be empty);
 * `thumbnailKey` is the cache key of the thumbnail route. `id` is the item id, or
 * `s:<albumId>:<itemId>` for a photo of an album shared with the account.
 */
export interface SynologyAsset extends SourceAsset {
  thumbnailKey: string;
}

/**
 * One page of `GET .../synology/{albums|shared-albums|folders}/{id}/assets?page=N` (photos only).
 */
export type SynologyAssetPage = SourceAssetPage<SynologyAsset>;

/** Reference to a folder of the Personal Space. */
export interface SynologyFolderRef {
  id: string;
  /** Last path segment; `""` for the root folder. */
  name: string;
  /** Full path, e.g. `/Holidays/2024`; `/` for the root folder. */
  path: string;
}

/** Folder as returned by `GET .../synology/folders/{folderId}` with its direct subfolders. */
export interface SynologyFolder extends SynologyFolderRef {
  /** Id of the parent folder; `null` for the root folder. */
  parentId: string | null;
  /** Direct subfolders, sorted by name. */
  folders: SynologyFolderRef[];
}

/** Folder id of the root folder of the Personal Space in the folder routes. */
export const SYNOLOGY_ROOT_FOLDER = 'root';

/** URL of the grid thumbnail of a Synology photo, proxied by the backend (usable as `<img src>`). */
export function synologyThumbnailUrl(connectorId: number, asset: SynologyAsset): string {
  // The route needs a key; the NAS does not check it (it only busts caches). The fallback uses
  // the item id (last segment of a shared id `s:<albumId>:<itemId>`).
  const key = asset.thumbnailKey || `${asset.id.slice(asset.id.lastIndexOf(':') + 1)}_0`;
  return `/api/connectors/${connectorId}/synology/assets/${encodeURIComponent(asset.id)}/thumbnail?key=${encodeURIComponent(key)}`;
}
