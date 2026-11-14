import { Component, input, output } from '@angular/core';
import { FormControl } from '@angular/forms';
import { NumberLimits } from '../../../shared/number-limits';
import { LengthUnit } from '../geometry/length-unit';
import { ColorField } from './color-field';
import { LengthField } from './length-field';

/** Allowed border width in mm (collage default border and per-photo border). */
export const BORDER_WIDTH_LIMITS = { min: 0, max: 20, step: 0.5 } as const satisfies NumberLimits;

/**
 * Border width (in the display unit) and colour in one row. The owner creates the controls (width
 * in mm with `limitValidators(BORDER_WIDTH_LIMITS)`); `committed` is emitted when one of them is
 * committed, `colorPreview` while the colour is changed in the picker.
 */
@Component({
  selector: 'app-border-fields',
  imports: [ColorField, LengthField],
  template: `
    <app-length-field
      [control]="widthControl()"
      [limits]="limits"
      [lengthUnit]="lengthUnit()"
      i18n-label="@@editor.settings.borderWidth"
      label="Border"
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
  /** Display unit of the width with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();
  readonly committed = output<void>();
  /** The colour while it is changed in the picker (not committed yet). */
  readonly colorPreview = output<string>();

  protected readonly limits = BORDER_WIDTH_LIMITS;
}
