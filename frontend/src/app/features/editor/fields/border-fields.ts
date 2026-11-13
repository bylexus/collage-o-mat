import { Component, input, output } from '@angular/core';
import { FormControl } from '@angular/forms';
import { NumberLimits } from '../../../shared/number-limits';
import { ColorField } from './color-field';
import { NumberField } from './number-field';

/** Allowed border width in mm (collage default border and per-photo border). */
export const BORDER_WIDTH_LIMITS = { min: 0, max: 20, step: 0.5 } as const satisfies NumberLimits;

/**
 * Border width and colour in one row. The owner creates the controls (width with
 * `limitValidators(BORDER_WIDTH_LIMITS)`); `committed` is emitted when one of them is committed,
 * `colorPreview` while the colour is changed in the picker.
 */
@Component({
  selector: 'app-border-fields',
  imports: [ColorField, NumberField],
  template: `
    <app-number-field
      [control]="widthControl()"
      [limits]="limits"
      i18n-label="@@editor.settings.borderWidthMm"
      label="Border (mm)"
      (committed)="committed.emit()"
    />
    <app-color-field
      class="border-color"
      [control]="colorControl()"
      i18n-label="@@editor.settings.borderColor"
      label="Border colour"
      (previewed)="colorPreview.emit($event)"
      (committed)="committed.emit()"
    />
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      gap: 12px;

      > * {
        flex: 1;
        min-width: 0;
      }
    }

    .border-color {
      align-self: center;
    }
  `,
})
export class BorderFields {
  readonly widthControl = input.required<FormControl<number>>();
  readonly colorControl = input.required<FormControl<string>>();
  readonly committed = output<void>();
  /** The colour while it is changed in the picker (not committed yet). */
  readonly colorPreview = output<string>();

  protected readonly limits = BORDER_WIDTH_LIMITS;
}
