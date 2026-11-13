import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSliderModule } from '@angular/material/slider';
import { map } from 'rxjs';
import { PageSettings } from '../../../core/models/collage';
import { limitValidators } from '../../../shared/number-limits';
import { NumberField } from '../fields/number-field';
import { SETTINGS_LIMITS } from '../settings-panel/settings-limits';
import { exportErrorMessage, SIDE_LIMIT_MESSAGE } from './export-error-message';
import {
  ExportFormat,
  ExportOptions,
  exportPixelSize,
  fitsSideLimit,
  JPG_QUALITY_LIMITS,
} from './page-export';

/** JPG quality preselected in the dialog. */
const DEFAULT_JPG_QUALITY = 0.9;

/** Input of the export dialog. */
export interface ExportDialogData {
  /** Page of the collage; its DPI is the preselected export DPI. */
  page: PageSettings;
  /**
   * Renders and downloads the image (done by the editor page). A rejected promise keeps the
   * dialog open and shows the error; on success the dialog closes with `true`.
   */
  runExport: (options: ExportOptions) => Promise<unknown>;
}

/**
 * Export of the page as PNG or JPG: format, JPG quality and DPI (for this export only, the collage
 * setting does not change). Shows the pixel size live and blocks sizes above the side limit.
 */
@Component({
  selector: 'app-export-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatSliderModule,
    NumberField,
  ],
  templateUrl: './export-dialog.html',
  styleUrl: './export-dialog.scss',
})
export class ExportDialog {
  private readonly data = inject<ExportDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ExportDialog, boolean>>(MatDialogRef);

  protected readonly dpiLimits = SETTINGS_LIMITS.dpi;
  protected readonly qualityLimits = JPG_QUALITY_LIMITS;

  protected readonly form = inject(NonNullableFormBuilder).group({
    format: ['png' as ExportFormat],
    jpgQuality: [DEFAULT_JPG_QUALITY],
    dpi: [this.data.page.dpi, limitValidators(SETTINGS_LIMITS.dpi)],
  });

  protected readonly format = toSignal(this.form.controls.format.valueChanges, {
    initialValue: this.form.controls.format.value,
  });
  protected readonly jpgQuality = toSignal(this.form.controls.jpgQuality.valueChanges, {
    initialValue: this.form.controls.jpgQuality.value,
  });

  /** Entered DPI; `null` while the field is not valid. Updates on every keystroke. */
  private readonly validDpi = toSignal(
    this.form.controls.dpi.valueChanges.pipe(map(() => this.currentValidDpi())),
    { initialValue: this.currentValidDpi() },
  );

  /** Pixel size of the image at the entered DPI; `null` while the DPI is not valid. */
  protected readonly pixelSize = computed(() => {
    const dpi = this.validDpi();
    return dpi === null ? null : exportPixelSize(this.data.page, dpi);
  });

  /** Error shown before the export if the image would be too large. */
  protected readonly sizeError = computed(() => {
    const size = this.pixelSize();
    return size !== null && !fitsSideLimit(size) ? SIDE_LIMIT_MESSAGE : null;
  });

  protected readonly exporting = signal(false);
  /** Error of the last export attempt; removed when the user changes a value. */
  protected readonly error = signal<string | null>(null);

  protected readonly canExport = computed(
    () => this.pixelSize() !== null && this.sizeError() === null && !this.exporting(),
  );

  /** Slider label: quality in percent. */
  protected readonly formatPercent = (value: number): string => `${Math.round(value * 100)} %`;

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null));
  }

  protected async submit(): Promise<void> {
    if (!this.canExport()) {
      this.form.markAllAsTouched();
      return;
    }
    const { format, jpgQuality, dpi } = this.form.getRawValue();
    this.setExporting(true);
    this.error.set(null);
    try {
      await this.data.runExport({ format, jpgQuality, dpi });
      this.ref.close(true);
    } catch (err) {
      this.error.set(exportErrorMessage(err));
      this.setExporting(false);
    }
  }

  private currentValidDpi(): number | null {
    const control = this.form.controls.dpi;
    // `invalid` (not `!valid`): a disabled control during the export keeps its size.
    return control.invalid ? null : control.value;
  }

  private setExporting(exporting: boolean): void {
    this.exporting.set(exporting);
    this.ref.disableClose = exporting;
    // No value events: enabling the form again must not remove the error of the export.
    if (exporting) {
      this.form.disable({ emitEvent: false });
    } else {
      this.form.enable({ emitEvent: false });
    }
  }
}
