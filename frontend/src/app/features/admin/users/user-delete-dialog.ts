import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AdminUser } from '../../../core/models/admin';
import { errorMessage } from '../../../shared/error-message';

/** Input of the delete user dialog. */
export interface UserDeleteDialogData {
  user: AdminUser;
  /**
   * Deletes the user (done by the page). A rejected promise keeps the dialog open and shows the
   * error; on success the dialog closes with `true`.
   */
  remove: () => Promise<unknown>;
}

/** Delete confirmation: the admin must type the username exactly to enable the Delete button. */
@Component({
  selector: 'app-user-delete-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title i18n="@@admin.delete.title">Delete user?</h2>
    <form (ngSubmit)="submit()">
      <mat-dialog-content class="dialog-fields">
        <p class="dialog-text" i18n="@@admin.delete.message">
          The user "{{ data.user.username }}" will be deleted with all collages
          ({{ data.user.collageCount }}), photos ({{ data.user.photoCount }}), connectors and the
          avatar. This cannot be undone.
        </p>
        <mat-form-field>
          <mat-label i18n="@@admin.delete.typeUsername">Type the username to confirm</mat-label>
          <input
            #confirmInput
            matInput
            name="confirmUsername"
            autocomplete="off"
            [disabled]="deleting()"
            (input)="typed.set(confirmInput.value)"
            cdkFocusInitial
          />
        </mat-form-field>

        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close [disabled]="deleting()">
          <ng-container i18n="@@admin.dialog.cancel">Cancel</ng-container>
        </button>
        <button
          matButton="filled"
          type="submit"
          class="destructive"
          [disabled]="typed() !== data.user.username || deleting()"
        >
          @if (deleting()) {
            <mat-spinner class="dialog-spinner" diameter="18" />
          }
          <ng-container i18n="@@admin.delete.confirm">Delete</ng-container>
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styleUrl: './user-dialog.scss',
})
export class UserDeleteDialog {
  protected readonly data = inject<UserDeleteDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<UserDeleteDialog, boolean>>(MatDialogRef);

  protected readonly typed = signal('');
  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.typed() !== this.data.user.username || this.deleting()) {
      return;
    }
    this.setDeleting(true);
    this.error.set(null);
    try {
      await this.data.remove();
      this.ref.close(true);
    } catch (err) {
      this.error.set(errorMessage(err));
      this.setDeleting(false);
    }
  }

  private setDeleting(deleting: boolean): void {
    this.deleting.set(deleting);
    this.ref.disableClose = deleting;
  }
}
