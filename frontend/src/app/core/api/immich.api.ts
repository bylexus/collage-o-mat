import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ImmichAlbum, ImmichAssetPage } from '../models/immich';

/** HTTP calls of the Immich proxy routes `/api/connectors/{id}/immich`. Holds no state. */
@Injectable({ providedIn: 'root' })
export class ImmichApi {
  private readonly http = inject(HttpClient);

  /** Albums visible to the API key of the connector. */
  albums(connectorId: number): Observable<ImmichAlbum[]> {
    return this.http.get<ImmichAlbum[]>(`/api/connectors/${connectorId}/immich/albums`);
  }

  /** One page of the image assets of an album; `page` starts at 1. */
  assets(connectorId: number, albumId: string, page: number): Observable<ImmichAssetPage> {
    return this.http.get<ImmichAssetPage>(
      `/api/connectors/${connectorId}/immich/albums/${encodeURIComponent(albumId)}/assets`,
      { params: { page } },
    );
  }
}
