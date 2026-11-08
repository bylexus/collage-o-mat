import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

/** Input of the confirm dialog. */
export interface ConfirmDialogData {
  title: string;
  message: string;
  /** Label of the confirm button; default "OK". */
  confirmLabel?: string;
  /** Label of the cancel button; default "Cancel". */
  cancelLabel?: string;
  /** Shows the confirm button in the error colour (e.g. for delete). */
  destructive?: boolean;
}

/** Yes/no dialog. Closes with `true` (confirm), `false` (cancel) or `undefined` (Esc/backdrop). */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="confirm-message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" [mat-dialog-close]="false">{{ cancelLabel }}</button>
      <button
        matButton="filled"
        type="button"
        cdkFocusInitial
        [class.destructive]="data.destructive"
        [mat-dialog-close]="true"
      >
        {{ confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    @use '@angular/material' as mat;

    .confirm-message {
      margin: 0;
      white-space: pre-line;
    }

    .destructive {
      @include mat.button-overrides(
        (
          filled-container-color: var(--mat-sys-error),
          filled-label-text-color: var(--mat-sys-on-error),
        )
      );
    }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  protected readonly confirmLabel = this.data.confirmLabel ?? $localize`:@@shared.confirm.ok:OK`;
  protected readonly cancelLabel =
    this.data.cancelLabel ?? $localize`:@@shared.confirm.cancel:Cancel`;
}
