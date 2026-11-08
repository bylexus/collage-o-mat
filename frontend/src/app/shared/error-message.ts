import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turns an error into a text for the user:
 * - `HttpErrorResponse` with a JSON body `{"error": "..."}` → that message
 * - `HttpErrorResponse` with status 0 (no connection) → network error text
 * - anything else → `fallback`, or a generic text
 */
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return $localize`:@@shared.error.network:Cannot reach the server. Please check your connection.`;
    }
    const message: unknown = err.error?.error;
    if (typeof message === 'string' && message !== '') {
      return message;
    }
  }
  return fallback ?? $localize`:@@shared.error.generic:Something went wrong. Please try again.`;
}
