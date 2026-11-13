import { Component, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BorderSettings, defaultCollageSettings } from '../../../core/models/collage';
import { limitValidators } from '../../../shared/number-limits';
import { BORDER_WIDTH_LIMITS, BorderFields } from '../fields/border-fields';
import { ColorField } from '../fields/color-field';
import { syncFromInput } from '../fields/sync-from-input';

/**
 * Background colour, default photo border and "Apply to all photos" (removes the borders of
 * single photos). Emits each valid change.
 */
@Component({
  selector: 'app-appearance-settings-section',
  imports: [MatButtonModule, MatIconModule, BorderFields, ColorField],
  template: `
    <app-color-field
      [control]="form.controls.backgroundColor"
      i18n-label="@@editor.settings.backgroundColor"
      label="Background colour"
      (committed)="commitBackground()"
    />
    <app-border-fields
      [widthControl]="form.controls.borderWidthMm"
      [colorControl]="form.controls.borderColor"
      (committed)="commitBorder()"
    />
    <p class="settings-note" i18n="@@editor.settings.borderHint">
      Default border of all photos without an own border.
    </p>
    <button
      matButton="outlined"
      type="button"
      class="apply-border-button"
      [disabled]="!hasBorderOverrides()"
      (click)="applyBorderToAll.emit()"
    >
      <mat-icon>border_outer</mat-icon>
      <span i18n="@@editor.settings.applyBorderToAll">Apply to all photos</span>
    </button>
    <p class="settings-note" i18n="@@editor.settings.applyBorderToAllHint">
      Removes the individual borders of all photos.
    </p>
  `,
  styleUrl: '../fields/panel-section.scss',
  styles: `
    .apply-border-button {
      align-self: flex-start;
    }
  `,
})
export class AppearanceSettingsSection {
  readonly backgroundColor = input.required<string>();
  readonly defaultBorder = input.required<BorderSettings>();
  /** True if at least one photo has an own border ("Apply to all photos" is enabled only then). */
  readonly hasBorderOverrides = input(false);
  readonly backgroundColorChange = output<string>();
  readonly defaultBorderChange = output<BorderSettings>();
  readonly applyBorderToAll = output<void>();

  private readonly defaults = defaultCollageSettings();
  protected readonly form = inject(NonNullableFormBuilder).group({
    backgroundColor: [this.defaults.backgroundColor],
    borderWidthMm: [this.defaults.defaultBorder.widthMm, limitValidators(BORDER_WIDTH_LIMITS)],
    borderColor: [this.defaults.defaultBorder.color],
  });

  constructor() {
    syncFromInput(this.backgroundColor, (color) =>
      this.form.controls.backgroundColor.setValue(color),
    );
    syncFromInput(this.defaultBorder, ({ widthMm, color }) => {
      this.form.controls.borderWidthMm.reset(widthMm);
      this.form.controls.borderColor.setValue(color);
    });
  }

  protected commitBackground(): void {
    this.backgroundColorChange.emit(this.form.controls.backgroundColor.value);
  }

  protected commitBorder(): void {
    const { borderWidthMm, borderColor } = this.form.controls;
    if (borderWidthMm.invalid) {
      borderWidthMm.markAsTouched();
      return;
    }
    this.defaultBorderChange.emit({ widthMm: borderWidthMm.value, color: borderColor.value });
  }
}
