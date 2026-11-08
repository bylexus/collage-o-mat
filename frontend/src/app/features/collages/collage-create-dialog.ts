import { Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  COLLAGE_NAME_MAX_LENGTH,
  CreateCollageRequest,
  CUSTOM_PAGE_SIZE_MAX_MM,
  CUSTOM_PAGE_SIZE_MIN_MM,
  CUSTOM_PRESET_LABEL,
  defaultCollageSettings,
  FIXED_PAGE_PRESETS,
} from '../../core/models/collage';
import { createPageSizeForm } from '../../shared/page-size-form';
import { collageNameValidators } from './collage-name';

/**
 * Asks for the name and page of a new collage. Closes with the create request (default settings
 * with the chosen page), or `undefined` on cancel.
 */
@Component({
  selector: 'app-collage-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './collage-create-dialog.html',
  styleUrl: './collage-create-dialog.scss',
})
export class CollageCreateDialog {
  private readonly dialogRef =
    inject<MatDialogRef<CollageCreateDialog, CreateCollageRequest>>(MatDialogRef);

  protected readonly presets = FIXED_PAGE_PRESETS;
  protected readonly customPresetLabel = CUSTOM_PRESET_LABEL;
  protected readonly nameMaxLength = COLLAGE_NAME_MAX_LENGTH;
  protected readonly sideMinMm = CUSTOM_PAGE_SIZE_MIN_MM;
  protected readonly sideMaxMm = CUSTOM_PAGE_SIZE_MAX_MM;

  private readonly pageForm = createPageSizeForm(defaultCollageSettings().page);
  protected readonly isCustom = this.pageForm.isCustom;

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', collageNameValidators],
    ...this.pageForm.controls,
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close({
      name: this.form.controls.name.value.trim(),
      settings: { ...defaultCollageSettings(), page: this.pageForm.pageSettings() },
    });
  }
}
