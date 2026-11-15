import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from '../models/user';

/** HTTP calls of `/api/profile` (own password and avatar). Holds no state. */
@Injectable({ providedIn: 'root' })
export class ProfileApi {
  private readonly http = inject(HttpClient);

  /**
   * Changes the own password. Fails with 400 (e.g. wrong current password, password rules) or 429
   * (too many failed attempts); the body has an `error` message. Other sessions of the user end.
   */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.put<void>('/api/profile/password', { currentPassword, newPassword });
  }

  /**
   * Sets the own avatar from a local image file (JPEG, PNG or WebP, max 10 MiB). The raw file is the
   * body, its MIME type the `Content-Type`. Returns the updated user.
   */
  uploadAvatar(file: File): Observable<User> {
    return this.http.put<User>('/api/profile/avatar', file, {
      headers: new HttpHeaders({ 'Content-Type': file.type }),
    });
  }

  /** Removes the own avatar (also when none is set). Returns the updated user. */
  deleteAvatar(): Observable<User> {
    return this.http.delete<User>('/api/profile/avatar');
  }

  /** URL of the own avatar image; the version is the cache buster (`User.avatarVersion`). */
  avatarUrl(version: number): string {
    return `/api/profile/avatar?v=${version}`;
  }
}
