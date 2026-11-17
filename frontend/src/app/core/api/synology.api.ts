import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SynologyAlbum, SynologyAssetPage, SynologyFolder } from '../models/synology';

/** HTTP calls of the Synology proxy routes `/api/connectors/{id}/synology`. Holds no state. */
@Injectable({ providedIn: 'root' })
export class SynologyApi {
  private readonly http = inject(HttpClient);

  /** Own albums of the account (Personal Space), sorted by name. */
  albums(connectorId: number): Observable<SynologyAlbum[]> {
    return this.http.get<SynologyAlbum[]>(`/api/connectors/${connectorId}/synology/albums`);
  }

  /** One page of the photos of an album; `page` starts at 1. */
  albumAssets(connectorId: number, albumId: string, page: number): Observable<SynologyAssetPage> {
    return this.http.get<SynologyAssetPage>(
      `/api/connectors/${connectorId}/synology/albums/${encodeURIComponent(albumId)}/assets`,
      { params: { page } },
    );
  }

  /** Albums of other users that are shared with the account, sorted by name. */
  sharedAlbums(connectorId: number): Observable<SynologyAlbum[]> {
    return this.http.get<SynologyAlbum[]>(`/api/connectors/${connectorId}/synology/shared-albums`);
  }

  /**
   * One page of the photos of a shared album; `page` starts at 1. The asset ids have the form
   * `s:<albumId>:<itemId>`.
   */
  sharedAlbumAssets(
    connectorId: number,
    albumId: string,
    page: number,
  ): Observable<SynologyAssetPage> {
    return this.http.get<SynologyAssetPage>(
      `/api/connectors/${connectorId}/synology/shared-albums/${encodeURIComponent(albumId)}/assets`,
      { params: { page } },
    );
  }

  /** A folder with its direct subfolders; `folderId` is a folder id or `SYNOLOGY_ROOT_FOLDER`. */
  folder(connectorId: number, folderId: string): Observable<SynologyFolder> {
    return this.http.get<SynologyFolder>(
      `/api/connectors/${connectorId}/synology/folders/${encodeURIComponent(folderId)}`,
    );
  }

  /**
   * One page of the direct photos of a folder; `folderId` is a folder id or
   * `SYNOLOGY_ROOT_FOLDER`; `page` starts at 1.
   */
  folderAssets(connectorId: number, folderId: string, page: number): Observable<SynologyAssetPage> {
    return this.http.get<SynologyAssetPage>(
      `/api/connectors/${connectorId}/synology/folders/${encodeURIComponent(folderId)}/assets`,
      { params: { page } },
    );
  }
}
