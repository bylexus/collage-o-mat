import { Component, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { startWith, switchMap } from 'rxjs';
import type {
  BorderSettings,
  BorderType,
  CornerSizeMode,
  CornersBorderSettings,
  PolaroidFormat,
} from '../../../core/models/collage';
import { limitValidators, NumberLimits } from '../../../shared/number-limits';
import { LengthUnit } from '../geometry/length-unit';
import { ColorField } from './color-field';
import { LengthField } from './length-field';
import { NumberField } from './number-field';

/** Allowed width in mm of the `color` border type (collage default border and per-photo border). */
export const BORDER_WIDTH_LIMITS = { min: 0, max: 20, step: 0.5 } as const satisfies NumberLimits;

/** Allowed leg length of the photo corners: in mm (mode `fixed`) and in % (mode `relative`). */
export const CORNER_SIZE_LIMITS = {
  sizeMm: { min: 2, max: 40, step: 0.5 },
  sizePercent: { min: 5, max: 40, step: 1 },
} as const satisfies Record<string, NumberLimits>;

/** Options of the "Border type" select, in display order. */
const BORDER_TYPE_OPTIONS: readonly { value: BorderType; label: string }[] = [
  { value: 'none', label: $localize`:@@editor.border.typeNone:None` },
  { value: 'color', label: $localize`:@@editor.border.typeColor:Colour` },
  { value: 'polaroid', label: $localize`:@@editor.border.typePolaroid:Polaroid` },
  { value: 'corners', label: $localize`:@@editor.border.typeCorners:Photo corners` },
];

/** Options of the photo corners "Size mode" select, in display order. */
const CORNER_SIZE_MODE_OPTIONS: readonly { value: CornerSizeMode; label: string }[] = [
  { value: 'fixed', label: $localize`:@@editor.border.cornerSizeFixed:Fixed` },
  { value: 'relative', label: $localize`:@@editor.border.cornerSizeRelative:Relative to frame` },
];

/** Options of the Polaroid "Format" select, in display order. */
const POLAROID_FORMAT_OPTIONS: readonly { value: PolaroidFormat; label: string }[] = [
  { value: 'p600', label: $localize`:@@editor.border.polaroidP600:Polaroid 600 / i-Type` },
  { value: 'go', label: $localize`:@@editor.border.polaroidGo:Polaroid Go` },
  { value: 'spectra', label: $localize`:@@editor.border.polaroidSpectra:Polaroid Spectra` },
];

/** Values of the border form: the same shape as `BorderSettings`. */
export type BorderFormValue = BorderSettings;

/** Form group of the border fields (see `borderFormGroup`): the type and one sub-group per type. */
export type BorderFormGroup = FormGroup<{
  type: FormControl<BorderType>;
  color: FormGroup<{ widthMm: FormControl<number>; color: FormControl<string> }>;
  polaroid: FormGroup<{ format: FormControl<PolaroidFormat>; color: FormControl<string> }>;
  corners: FormGroup<{
    color: FormControl<string>;
    sizeMode: FormControl<CornerSizeMode>;
    sizeMm: FormControl<number>;
    sizePercent: FormControl<number>;
  }>;
}>;

/** A border form group with the limit validators, filled with `border`. */
export function borderFormGroup(
  fb: NonNullableFormBuilder,
  border: BorderSettings,
): BorderFormGroup {
  const value = toBorderFormValue(border);
  return fb.group({
    type: [value.type],
    color: fb.group({
      widthMm: [value.color.widthMm, limitValidators(BORDER_WIDTH_LIMITS)],
      color: [value.color.color],
    }),
    polaroid: fb.group({
      format: [value.polaroid.format],
      color: [value.polaroid.color],
    }),
    corners: fb.group({
      color: [value.corners.color],
      sizeMode: [value.corners.sizeMode],
      sizeMm: [value.corners.sizeMm, limitValidators(CORNER_SIZE_LIMITS.sizeMm)],
      sizePercent: [value.corners.sizePercent, limitValidators(CORNER_SIZE_LIMITS.sizePercent)],
    }),
  });
}

/** Form values of a border. */
export function toBorderFormValue(border: BorderSettings): BorderFormValue {
  return {
    type: border.type,
    color: { ...border.color },
    polaroid: { ...border.polaroid },
    corners: { ...border.corners },
  };
}

/**
 * The border of the form, or `null` if the fields of the selected type are invalid. The values of
 * an other type that are invalid (e.g. edited and then the type changed) are taken from `fallback`.
 * Photo corners: only the size field of the selected size mode counts; an invalid hidden size field
 * is taken from `fallback` (value by value).
 */
export function borderFromForm(
  group: BorderFormGroup,
  fallback: BorderSettings,
): BorderSettings | null {
  const { type, color, polaroid, corners } = group.controls;
  if (type.value === 'corners') {
    const size = corners.controls.sizeMode.value === 'fixed' ? 'sizeMm' : 'sizePercent';
    if (corners.controls.color.invalid || corners.controls[size].invalid) {
      return null;
    }
  } else if (type.value !== 'none' && group.controls[type.value].invalid) {
    return null;
  }
  const value = group.getRawValue();
  return {
    type: value.type,
    color: color.valid ? value.color : { ...fallback.color },
    polaroid: polaroid.valid ? value.polaroid : { ...fallback.polaroid },
    corners: cornersFromForm(group, fallback.corners),
  };
}

/** The corner values of the form; each invalid value is taken from `fallback`. */
function cornersFromForm(
  group: BorderFormGroup,
  fallback: CornersBorderSettings,
): CornersBorderSettings {
  const { color, sizeMode, sizeMm, sizePercent } = group.controls.corners.controls;
  return {
    color: color.valid ? color.value : fallback.color,
    sizeMode: sizeMode.valid ? sizeMode.value : fallback.sizeMode,
    sizeMm: sizeMm.valid ? sizeMm.value : fallback.sizeMm,
    sizePercent: sizePercent.valid ? sizePercent.value : fallback.sizePercent,
  };
}

/**
 * The border of the form with `color` as the colour of the selected type (a colour preview), or
 * `null` if the fields of the selected type are invalid.
 */
export function borderWithPreviewColor(
  group: BorderFormGroup,
  fallback: BorderSettings,
  color: string,
): BorderSettings | null {
  const border = borderFromForm(group, fallback);
  if (!border) {
    return null;
  }
  switch (border.type) {
    case 'none':
      return border;
    case 'color':
      return { ...border, color: { ...border.color, color } };
    case 'polaroid':
      return { ...border, polaroid: { ...border.polaroid, color } };
    case 'corners':
      return { ...border, corners: { ...border.corners, color } };
  }
}

/**
 * "Border type" select (None / Colour / Polaroid / Photo corners) and, below it, only the fields of
 * the selected type: Colour = width (in the display unit, the form in mm) and colour; Polaroid =
 * format and card colour; Photo corners = colour, size mode and the size of that mode (length in
 * the display unit, or % of the shorter frame side). The owner creates the form
 * group (e.g. with `borderFormGroup`); `committed` is emitted when the type changes or a field is
 * committed, `colorPreview` while a colour is changed in the picker.
 *
 * The fields follow the `valueChanges` of the `type` and the corners `sizeMode` control. An owner
 * that resets the group with `emitEvent: false` must then emit them for these controls.
 */
@Component({
  selector: 'app-border-fields',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    ColorField,
    LengthField,
    NumberField,
  ],
  template: `
    @let border = group().controls;
    <mat-form-field subscriptSizing="dynamic">
      <mat-label i18n="@@editor.border.type">Border type</mat-label>
      <mat-select [formControl]="border.type" (selectionChange)="committed.emit()">
        @for (option of typeOptions; track option.value) {
          <mat-option [value]="option.value">{{ option.label }}</mat-option>
        }
      </mat-select>
    </mat-form-field>
    @switch (type()) {
      @case ('color') {
        @let color = border.color.controls;
        <div class="field-row">
          <app-length-field
            [control]="color.widthMm"
            [limits]="limits"
            [lengthUnit]="lengthUnit()"
            i18n-label="@@editor.border.width"
            label="Width"
            (committed)="committed.emit()"
          />
          <app-color-field
            class="color-cell"
            [control]="color.color"
            i18n-label="@@editor.border.color"
            label="Colour"
            (previewed)="colorPreview.emit($event)"
            (committed)="committed.emit()"
          />
        </div>
      }
      @case ('polaroid') {
        @let polaroid = border.polaroid.controls;
        <div class="field-row">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label i18n="@@editor.border.polaroidFormat">Format</mat-label>
            <mat-select [formControl]="polaroid.format" (selectionChange)="committed.emit()">
              @for (option of formatOptions; track option.value) {
                <mat-option [value]="option.value">{{ option.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-color-field
            class="color-cell"
            [control]="polaroid.color"
            i18n-label="@@editor.border.polaroidColor"
            label="Card colour"
            (previewed)="colorPreview.emit($event)"
            (committed)="committed.emit()"
          />
        </div>
      }
      @case ('corners') {
        @let corners = border.corners.controls;
        <div class="field-row">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label i18n="@@editor.border.cornerSizeMode">Size mode</mat-label>
            <mat-select [formControl]="corners.sizeMode" (selectionChange)="committed.emit()">
              @for (option of sizeModeOptions; track option.value) {
                <mat-option [value]="option.value">{{ option.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-color-field
            class="color-cell"
            [control]="corners.color"
            i18n-label="@@editor.border.cornerColor"
            label="Colour"
            (previewed)="colorPreview.emit($event)"
            (committed)="committed.emit()"
          />
        </div>
        @if (sizeMode() === 'fixed') {
          <app-length-field
            [control]="corners.sizeMm"
            [limits]="cornerLimits.sizeMm"
            [lengthUnit]="lengthUnit()"
            i18n-label="@@editor.border.cornerSize"
            label="Size"
            (committed)="committed.emit()"
          />
        } @else {
          <app-number-field
            [control]="corners.sizePercent"
            [limits]="cornerLimits.sizePercent"
            i18n-label="@@editor.border.cornerSizePercent"
            label="Size (%)"
            (committed)="committed.emit()"
          />
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    mat-form-field {
      width: 100%;
    }

    .field-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;

      > * {
        flex: 1;
        min-width: 0;
      }
    }

    .color-cell {
      align-self: center;
    }
  `,
})
export class BorderFields {
  readonly group = input.required<BorderFormGroup>();
  /** Display unit of the length fields with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();
  readonly committed = output<void>();
  /** A colour of the selected type while it is changed in the picker (not committed yet). */
  readonly colorPreview = output<string>();

  protected readonly limits = BORDER_WIDTH_LIMITS;
  protected readonly typeOptions = BORDER_TYPE_OPTIONS;
  protected readonly formatOptions = POLAROID_FORMAT_OPTIONS;
  protected readonly cornerLimits = CORNER_SIZE_LIMITS;
  protected readonly sizeModeOptions = CORNER_SIZE_MODE_OPTIONS;

  /** Value of the `type` control; follows a new group instance. */
  protected readonly type = toSignal(
    toObservable(this.group).pipe(
      switchMap(({ controls: { type } }) => type.valueChanges.pipe(startWith(type.value))),
    ),
    { initialValue: 'none' as BorderType },
  );

  /** Value of the corners `sizeMode` control; follows a new group instance. */
  protected readonly sizeMode = toSignal(
    toObservable(this.group).pipe(
      switchMap(({ controls: { corners } }) => {
        const { sizeMode } = corners.controls;
        return sizeMode.valueChanges.pipe(startWith(sizeMode.value));
      }),
    ),
    { initialValue: 'relative' as CornerSizeMode },
  );
}
