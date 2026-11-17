import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { GooglePhotosPick, GooglePhotosPickStart } from '../models/google-photos';

/** HTTP calls of the Google Photos pick routes `/api/connectors/{id}/googlephotos`. Holds no state. */
@Injectable({ providedIn: 'root' })
export class GooglePhotosApi {
  private readonly http = inject(HttpClient);

  /**
   * Starts a new pick. The popup window opens `openUrl` (Google sign-in or picker page).
   * 429 if the user has too many open picks.
   */
  createPick(connectorId: number): Observable<GooglePhotosPickStart> {
    return this.http.post<GooglePhotosPickStart>(
      `/api/connectors/${connectorId}/googlephotos/picks`,
      {},
    );
  }

  /** State of a pick; while the user picks, the backend asks Google (poll this). */
  getPick(connectorId: number, pickId: string): Observable<GooglePhotosPick> {
    return this.http.get<GooglePhotosPick>(
      `/api/connectors/${connectorId}/googlephotos/picks/${encodeURIComponent(pickId)}`,
    );
  }

  /** Removes a pick and its Google picker session. */
  deletePick(connectorId: number, pickId: string): Observable<void> {
    return this.http.delete<void>(
      `/api/connectors/${connectorId}/googlephotos/picks/${encodeURIComponent(pickId)}`,
    );
  }
}
