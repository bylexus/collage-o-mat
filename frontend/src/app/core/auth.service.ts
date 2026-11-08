import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { User } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly user = signal<User | null>(null);
  private loaded: Promise<void> | null = null;

  readonly currentUser = this.user.asReadonly();
  readonly isLoggedIn = computed(() => this.user() !== null);

  /** Resolves when the initial `/api/auth/me` check has finished (runs it once). */
  ensureLoaded(): Promise<void> {
    this.loaded ??= this.loadMe();
    return this.loaded;
  }

  /** Loads the current user from the session cookie; 401 (or any error) means "not logged in". */
  async loadMe(): Promise<void> {
    try {
      this.user.set(await firstValueFrom(this.http.get<User>('/api/auth/me')));
    } catch (err) {
      if (!(err instanceof HttpErrorResponse && err.status === 401)) {
        console.error('Failed to load current user', err);
      }
      this.user.set(null);
    }
  }

  /** Throws the `HttpErrorResponse` on failure (401 = wrong credentials). */
  async login(username: string, password: string): Promise<User> {
    const user = await firstValueFrom(
      this.http.post<User>('/api/auth/login', { username, password }),
    );
    this.user.set(user);
    this.loaded = Promise.resolve();
    return user;
  }

  /** Ends the session on the server. The local user is cleared also if the request fails. */
  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<void>('/api/auth/logout', {}));
    } finally {
      this.clearUser();
    }
  }

  /** Forgets the current user locally (e.g. after a 401 from the API). */
  clearUser(): void {
    this.user.set(null);
    this.loaded = Promise.resolve();
  }
}
