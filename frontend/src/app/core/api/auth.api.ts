import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from '../models/user';

/** HTTP calls of `/api/auth`. Holds no state (see `AuthService`). */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  /** Current user of the session cookie; fails with 401 without a valid session. */
  me(): Observable<User> {
    return this.http.get<User>('/api/auth/me');
  }

  /** Creates a session (sets the cookie); fails with 401 for wrong credentials. */
  login(username: string, password: string): Observable<User> {
    return this.http.post<User>('/api/auth/login', { username, password });
  }

  /** Deletes the session and clears the cookie. */
  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {});
  }
}
