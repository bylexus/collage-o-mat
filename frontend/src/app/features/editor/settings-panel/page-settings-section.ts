import { Component, computed, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import {
  CUSTOM_PRESET_LABEL,
  defaultCollageSettings,
  FIXED_PAGE_PRESETS,
  PageSettings,
} from '../../../core/models/collage';
import { limitValidators } from '../../../shared/number-limits';
import { createPageSizeForm, PAGE_SIDE_LIMITS } from '../../../shared/page-size-form';
import { mmToPx } from '../geometry/units';
import { NumberField } from './number-field';
import { SETTINGS_LIMITS } from './settings-limits';
import { syncFromInput } from './sync-from-input';

/** Page preset, orientation, custom size and DPI. Emits a new page on each valid change. */
@Component({
  selector: 'app-page-settings-section',
  imports: [
    ReactiveFormsModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatSelectModule,
    NumberField,
  ],
  templateUrl: './page-settings-section.html',
  styleUrl: './settings-section.scss',
})
export class PageSettingsSection {
  readonly page = input.required<PageSettings>();
  readonly pageChange = output<PageSettings>();

  protected readonly presets = FIXED_PAGE_PRESETS;
  protected readonly customPresetLabel = CUSTOM_PRESET_LABEL;
  protected readonly limits = { pageSide: PAGE_SIDE_LIMITS, dpi: SETTINGS_LIMITS.dpi };

  private readonly defaultPage = defaultCollageSettings().page;
  protected readonly pageForm = createPageSizeForm(this.defaultPage);
  protected readonly form = inject(NonNullableFormBuilder).group({
    ...this.pageForm.controls,
    dpi: [this.defaultPage.dpi, limitValidators(SETTINGS_LIMITS.dpi)],
  });

  /** Orientation matters only for fixed, non-square presets. */
  protected readonly showOrientation = computed(
    () => !this.pageForm.isCustom() && !this.pageForm.isSquare(),
  );

  /** Pixel size of the export at the page's DPI. */
  protected readonly exportSize = computed(() => {
    const { widthMm, heightMm, dpi } = this.page();
    return { width: Math.round(mmToPx(widthMm, dpi)), height: Math.round(mmToPx(heightMm, dpi)) };
  });

  constructor() {
    syncFromInput(this.page, (page) => {
      this.pageForm.setPage(page);
      this.form.controls.dpi.setValue(page.dpi);
      this.form.markAsUntouched();
    });
  }

  protected commit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pageChange.emit(this.pageForm.pageSettings(this.form.controls.dpi.value));
  }
}
