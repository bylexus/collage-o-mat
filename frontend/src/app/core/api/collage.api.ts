import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CollageDetail, CollageSummary, CreateCollageRequest } from '../models/collage';

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

  /** Deletes the collage with all its photos and texts. */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`/api/collages/${id}`);
  }
}
