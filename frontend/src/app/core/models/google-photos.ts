/** DTOs of the Google Photos pick routes `/api/connectors/{id}/googlephotos/picks...`. */

import { SourceAsset } from './source';

/** Answer of `POST .../googlephotos/picks`: a new pick (one Google picker session). */
export interface GooglePhotosPickStart {
  pickId: string;
  /** URL for the popup window: the Google sign-in page or the Google Photos picker page. */
  openUrl: string;
}

/**
 * State of a pick: `signin` = waiting for the Google sign-in, `picking` = the user picks photos in
 * the Google Photos page, `done` = the picked photos are listed, `error` = failed (see `error`).
 */
export type GooglePhotosPickStatus = 'signin' | 'picking' | 'done' | 'error';

/**
 * Picked photo. `id` is the Google media item id (also the asset id of the import); `width` and
 * `height` are 0 if unknown; `mimeType` is the MIME type of the original file (e.g. `image/heic`).
 */
export type GooglePhotosItem = SourceAsset;

/** Answer of `GET .../googlephotos/picks/{pickId}`. */
export interface GooglePhotosPick {
  status: GooglePhotosPickStatus;
  /** Time until the next poll in ms (from Google, clamped by the backend to 1–10 s). */
  pollIntervalMs: number;
  /** User-safe reason of status `error`. */
  error?: string;
  /** Picked photos; empty unless the status is `done`. */
  items: GooglePhotosItem[];
  /** Number of picked videos (and other non-photo items) that were dropped. */
  skippedVideos: number;
}

/**
 * URL of the grid thumbnail (fits in 400×400 px) of a picked photo, proxied by the backend
 * (usable as `<img src>`).
 */
export function googlePhotosThumbnailUrl(
  connectorId: number,
  pickId: string,
  itemId: string,
): string {
  return `/api/connectors/${connectorId}/googlephotos/picks/${encodeURIComponent(pickId)}/items/${encodeURIComponent(itemId)}/thumbnail`;
}
