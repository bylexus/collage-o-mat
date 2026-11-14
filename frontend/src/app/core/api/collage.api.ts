import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CollageDetail,
  CollageSummary,
  CreateCollageRequest,
  DuplicateCollageRequest,
  DuplicateCollageResponse,
} from '../models/collage';
import { SaveLayoutRequest } from '../models/layout';

/** HTTP calls of `/api/collages`. Holds no state. */
@Injectable({ providedIn: 'root' })
export class CollageApi {
  private readonly http = inject(HttpClient);

  /** Collages of the current user, most recently changed first. */
  list(): Observable<CollageSummary[]> {
    return this.http.get<CollageSummary[]>('/api/collages');
  }

  /** One collage with photos and texts; fails with 404 if it does not exist or is not the user's. */
  get(id: number): Observable<CollageDetail> {
    return this.http.get<CollageDetail>(`/api/collages/${id}`);
  }

  create(request: CreateCollageRequest): Observable<CollageSummary> {
    return this.http.post<CollageSummary>('/api/collages', request);
  }

  rename(id: number, name: string): Observable<CollageSummary> {
    return this.http.patch<CollageSummary>(`/api/collages/${id}`, { name });
  }

  /**
   * Copies the collage with all its photos (files too), photo props and texts under a new name.
   * Photos with a missing file are skipped and counted in `skippedPhotos`.
   */
  duplicate(id: number, name: string): Observable<DuplicateCollageResponse> {
    const request: DuplicateCollageRequest = { name };
    return this.http.post<DuplicateCollageResponse>(`/api/collages/${id}/duplicate`, request);
  }

  /**
   * Saves the full editor layout (settings and photo props) in one transaction. Fails with 400 if a
   * photo id is not in the collage.
   */
  saveLayout(id: number, request: SaveLayoutRequest): Observable<void> {
    return this.http.put<void>(`/api/collages/${id}/layout`, request);
  }

  /** Deletes the collage with all its photos and texts. */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`/api/collages/${id}`);
  }
}
