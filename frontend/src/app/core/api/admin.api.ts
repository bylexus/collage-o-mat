import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AdminUser, CreateUserRequest, SystemSettings, UpdateUserRequest } from '../models/admin';

/** HTTP calls of `/api/admin` (user management, system settings; admins only). Holds no state. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  /** All users with their collage and photo counts and storage usage, ordered by username. */
  listUsers(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>('/api/admin/users');
  }

  /** Creates an active user. Fails with 400 (validation) or 409 (username exists). */
  createUser(request: CreateUserRequest): Observable<AdminUser> {
    return this.http.post<AdminUser>('/api/admin/users', request);
  }

  /**
   * Changes admin role, active flag, storage limit and (optional) password in one request. Fails with 409 for the
   * own account or if no active admin would remain.
   */
  updateUser(id: number, request: UpdateUserRequest): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`/api/admin/users/${id}`, request);
  }

  /** Deletes the user with all collages, photos, connectors and the avatar. */
  deleteUser(id: number): Observable<void> {
    return this.http.delete<void>(`/api/admin/users/${id}`);
  }

  /** URL of the avatar of a user; the version is the cache buster (`AdminUser.avatarVersion`). */
  avatarUrl(id: number, version: number): string {
    return `/api/admin/users/${id}/avatar?v=${version}`;
  }

  getSettings(): Observable<SystemSettings> {
    return this.http.get<SystemSettings>('/api/admin/settings');
  }

  /** Replaces the settings; returns the stored settings. Fails with 400 on invalid values. */
  updateSettings(settings: SystemSettings): Observable<SystemSettings> {
    return this.http.put<SystemSettings>('/api/admin/settings', settings);
  }
}
