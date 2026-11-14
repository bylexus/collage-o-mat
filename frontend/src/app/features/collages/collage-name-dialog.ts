import { Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { COLLAGE_NAME_MAX_LENGTH } from '../../core/models/collage';
import { collageNameValidators } from './collage-name';

/** Input of the name dialog. */
export interface CollageNameDialogData {
  /** Initial value of the name field. */
  name: string;
  /** Dialog title (localized by the caller). */
  title: string;
  /** Text of the submit button (localized by the caller). */
  submitLabel: string;
}

/**
 * Asks for a collage name (rename, duplicate). Closes with the trimmed name, or `undefined` on
 * cancel.
 */
@Component({
  selector: 'app-collage-name-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <mat-form-field class="name-field">
          <mat-label i18n="@@collages.name.label">Name</mat-label>
          <input
            matInput
            formControlName="name"
            [attr.maxlength]="maxLength"
            cdkFocusInitial
            required
          />
          @if (form.controls.name.hasError('required')) {
            <mat-error i18n="@@collages.name.required">Name is required</mat-error>
          }
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close>
          <span i18n="@@collages.dialog.cancel">Cancel</span>
        </button>
        <button matButton="filled" type="submit">{{ data.submitLabel }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .name-field {
      width: 100%;
    }
  `,
})
export class CollageNameDialog {
  private readonly dialogRef = inject<MatDialogRef<CollageNameDialog, string>>(MatDialogRef);
  protected readonly data = inject<CollageNameDialogData>(MAT_DIALOG_DATA);

  protected readonly maxLength = COLLAGE_NAME_MAX_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.data.name, collageNameValidators],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(this.form.controls.name.value.trim());
  }
}
