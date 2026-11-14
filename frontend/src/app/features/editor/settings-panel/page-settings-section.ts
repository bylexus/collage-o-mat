import { Component, computed, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CUSTOM_PRESET_LABEL,
  defaultCollageSettings,
  DISPLAY_UNITS,
  DisplayUnit,
  FIXED_PAGE_PRESETS,
  PageSettings,
} from '../../../core/models/collage';
import { limitValidators } from '../../../shared/number-limits';
import { createPageSizeForm, PAGE_SIDE_LIMITS } from '../../../shared/page-size-form';
import { LengthField } from '../fields/length-field';
import { NumberField } from '../fields/number-field';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';
import { mmToPx } from '../../../core/models/units';
import { SETTINGS_LIMITS } from './settings-limits';

/**
 * Page preset, orientation, custom size, display unit and DPI. Emits a new page on each valid
 * change, and the display unit on its own (`displayUnitChange`, not part of the page).
 */
@Component({
  selector: 'app-page-settings-section',
  imports: [
    ReactiveFormsModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    LengthField,
    NumberField,
  ],
  templateUrl: './page-settings-section.html',
  styleUrl: '../fields/panel-section.scss',
  styles: `
    .page-row {
      display: flex;
      align-items: center;
      gap: 12px;

      mat-form-field {
        flex: 1;
        min-width: 0;
      }

      mat-button-toggle-group {
        flex: none;
        align-self: center;
      }
    }
  `,
})
export class PageSettingsSection {
  readonly page = input.required<PageSettings>();
  readonly pageChange = output<PageSettings>();
  /** Display unit of the lengths with the collage DPI (unit select, width and height fields). */
  readonly lengthUnit = input.required<LengthUnit>();
  /** The user selected another display unit. */
  readonly displayUnitChange = output<DisplayUnit>();

  protected readonly presets = FIXED_PAGE_PRESETS;
  protected readonly customPresetLabel = CUSTOM_PRESET_LABEL;
  protected readonly displayUnits = DISPLAY_UNITS;
  protected readonly limits = { pageSide: PAGE_SIDE_LIMITS, dpi: SETTINGS_LIMITS.dpi };

  private readonly defaultPage = defaultCollageSettings().page;
  protected readonly pageForm = createPageSizeForm(this.defaultPage);
  protected readonly form = inject(NonNullableFormBuilder).group({
    ...this.pageForm.controls,
    dpi: [this.defaultPage.dpi, limitValidators(SETTINGS_LIMITS.dpi)],
  });
  /** Display unit select; not part of `form` (it is not part of the page). */
  protected readonly unitControl = inject(NonNullableFormBuilder).control<DisplayUnit>('mm');

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
    syncFromInput(this.lengthUnit, ({ unit }) => this.unitControl.setValue(unit));
  }

  protected commit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pageChange.emit(this.pageForm.pageSettings(this.form.controls.dpi.value));
  }
}
