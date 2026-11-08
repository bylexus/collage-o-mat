import { Component, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder } from '@angular/forms';
import { BorderSettings, defaultCollageSettings } from '../../../core/models/collage';
import { limitValidators } from '../../../shared/number-limits';
import { ColorField } from './color-field';
import { NumberField } from './number-field';
import { SETTINGS_LIMITS } from './settings-limits';
import { syncFromInput } from './sync-from-input';

/** Background colour and default photo border. Emits each valid change. */
@Component({
  selector: 'app-appearance-settings-section',
  imports: [ColorField, NumberField],
  template: `
    <app-color-field
      [control]="form.controls.backgroundColor"
      i18n-label="@@editor.settings.backgroundColor"
      label="Background colour"
      (committed)="commitBackground()"
    />
    <div class="field-row">
      <app-number-field
        [control]="form.controls.borderWidthMm"
        [limits]="borderWidthLimits"
        i18n-label="@@editor.settings.borderWidthMm"
        label="Border (mm)"
        (committed)="commitBorder()"
      />
      <app-color-field
        class="border-color"
        [control]="form.controls.borderColor"
        i18n-label="@@editor.settings.borderColor"
        label="Border colour"
        (committed)="commitBorder()"
      />
    </div>
    <p class="settings-note" i18n="@@editor.settings.borderHint">
      Default border of all photos without an own border.
    </p>
  `,
  styleUrl: './settings-section.scss',
  styles: `
    .border-color {
      align-self: center;
    }
  `,
})
export class AppearanceSettingsSection {
  readonly backgroundColor = input.required<string>();
  readonly defaultBorder = input.required<BorderSettings>();
  readonly backgroundColorChange = output<string>();
  readonly defaultBorderChange = output<BorderSettings>();

  protected readonly borderWidthLimits = SETTINGS_LIMITS.borderWidthMm;

  private readonly defaults = defaultCollageSettings();
  protected readonly form = inject(NonNullableFormBuilder).group({
    backgroundColor: [this.defaults.backgroundColor],
    borderWidthMm: [this.defaults.defaultBorder.widthMm, limitValidators(this.borderWidthLimits)],
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
