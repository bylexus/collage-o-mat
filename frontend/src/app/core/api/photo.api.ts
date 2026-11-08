import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ImportRequest, ImportResult } from '../models/photo';

/** HTTP calls of the photos of a collage (`/api/collages/{id}/...`). Holds no state. */
@Injectable({ providedIn: 'root' })
export class PhotoApi {
  private readonly http = inject(HttpClient);

  /**
   * Imports assets of a connector into the collage (synchronous, can take several seconds).
   * Assets that are already in the collage are skipped.
   */
  import(collageId: number, request: ImportRequest): Observable<ImportResult> {
    return this.http.post<ImportResult>(`/api/collages/${collageId}/import`, request);
  }

  /** Deletes the photo and its file. */
  deletePhoto(collageId: number, photoId: number): Observable<void> {
    return this.http.delete<void>(`/api/collages/${collageId}/photos/${photoId}`);
  }
}
