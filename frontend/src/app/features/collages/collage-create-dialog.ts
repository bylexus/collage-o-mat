import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { merge } from 'rxjs';
import {
  COLLAGE_NAME_MAX_LENGTH,
  CreateCollageRequest,
  CUSTOM_PAGE_SIZE_MAX_MM,
  CUSTOM_PAGE_SIZE_MIN_MM,
  CUSTOM_PRESET_LABEL,
  customPageSettings,
  defaultCollageSettings,
  findFixedPreset,
  FIXED_PAGE_PRESETS,
  fixedPageSettings,
  orientedSize,
  PageOrientation,
  PagePresetId,
  PageSettings,
} from '../../core/models/collage';
import { collageNameValidators } from './collage-name';

const pageSideValidators = [
  Validators.required,
  Validators.min(CUSTOM_PAGE_SIZE_MIN_MM),
  Validators.max(CUSTOM_PAGE_SIZE_MAX_MM),
];

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

  private readonly defaultPage = defaultCollageSettings().page;

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', collageNameValidators],
    preset: [this.defaultPage.preset],
    orientation: [this.defaultPage.orientation],
    widthMm: [this.defaultPage.widthMm, pageSideValidators],
    heightMm: [this.defaultPage.heightMm, pageSideValidators],
  });

  private readonly preset = toSignal(this.form.controls.preset.valueChanges, {
    initialValue: this.form.controls.preset.value,
  });
  protected readonly isCustom = computed(() => this.preset() === 'Custom');

  constructor() {
    this.syncPageSize();
    merge(this.form.controls.preset.valueChanges, this.form.controls.orientation.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.syncPageSize());
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, preset, orientation, widthMm, heightMm } = this.form.getRawValue();
    this.dialogRef.close({
      name: name.trim(),
      settings: {
        ...defaultCollageSettings(),
        page: this.pageSettings(preset, orientation, widthMm, heightMm),
      },
    });
  }

  /**
   * For a fixed preset, shows its size in the (disabled) size fields, so that switching to
   * `Custom` starts with the last size. For `Custom`, enables the size fields.
   */
  private syncPageSize(): void {
    const { preset, orientation } = this.form.getRawValue();
    const fixed = findFixedPreset(preset);
    const { widthMm, heightMm } = this.form.controls;
    if (fixed) {
      this.form.patchValue(orientedSize(fixed.portrait, orientation), { emitEvent: false });
      widthMm.disable({ emitEvent: false });
      heightMm.disable({ emitEvent: false });
    } else {
      widthMm.enable({ emitEvent: false });
      heightMm.enable({ emitEvent: false });
    }
  }

  private pageSettings(
    preset: PagePresetId,
    orientation: PageOrientation,
    widthMm: number,
    heightMm: number,
  ): PageSettings {
    return preset === 'Custom'
      ? customPageSettings({ widthMm, heightMm })
      : fixedPageSettings(preset, orientation);
  }
}
