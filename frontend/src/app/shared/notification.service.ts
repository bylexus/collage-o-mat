import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

const SUCCESS_DURATION_MS = 3000;
const ERROR_DURATION_MS = 8000;

/** Short user feedback as a snackbar. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  /** Shows a short success message that closes by itself. */
  success(message: string): void {
    this.snackBar.open(message, undefined, { duration: SUCCESS_DURATION_MS });
  }

  /** Shows an error message that stays longer and has a "Close" action. */
  error(message: string): void {
    this.snackBar.open(message, $localize`:@@shared.notification.close:Close`, {
      duration: ERROR_DURATION_MS,
      politeness: 'assertive',
    });
  }
}
