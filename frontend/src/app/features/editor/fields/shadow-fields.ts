import { Component, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { startWith, switchMap } from 'rxjs';
import type { Shadow } from '../../../core/models/shadow';
import { limitValidators, NumberLimits } from '../../../shared/number-limits';
import { ColorField } from './color-field';
import { NumberField } from './number-field';

/** Limits of the numeric shadow fields (text shadow, collage default shadow, per-photo shadow). */
export const SHADOW_LIMITS = {
  blurMm: { min: 0, max: 20, step: 0.5 },
  /** Offset X and Y. */
  offsetMm: { min: -20, max: 20, step: 0.5 },
  /** Opacity in percent (stored as 0..1). */
  opacityPercent: { min: 0, max: 100, step: 5 },
} as const satisfies Record<string, NumberLimits>;

/** Values of the shadow form: a `Shadow` with the opacity in percent. */
export interface ShadowFormValue {
  enabled: boolean;
  color: string;
  /** 0..100 (stored as 0..1). */
  opacityPercent: number;
  blurMm: number;
  offsetXMm: number;
  offsetYMm: number;
}

/** Form group of the shadow fields (see `shadowFormGroup`). */
export type ShadowFormGroup = FormGroup<{
  [K in keyof ShadowFormValue]: FormControl<ShadowFormValue[K]>;
}>;

/** A shadow form group with the `SHADOW_LIMITS` validators, filled with `shadow`. */
export function shadowFormGroup(fb: NonNullableFormBuilder, shadow: Shadow): ShadowFormGroup {
  const value = toShadowFormValue(shadow);
  return fb.group({
    enabled: [value.enabled],
    color: [value.color],
    opacityPercent: [value.opacityPercent, limitValidators(SHADOW_LIMITS.opacityPercent)],
    blurMm: [value.blurMm, limitValidators(SHADOW_LIMITS.blurMm)],
    offsetXMm: [value.offsetXMm, limitValidators(SHADOW_LIMITS.offsetMm)],
    offsetYMm: [value.offsetYMm, limitValidators(SHADOW_LIMITS.offsetMm)],
  });
}

/** Form values of a shadow. */
export function toShadowFormValue(shadow: Shadow): ShadowFormValue {
  return {
    enabled: shadow.enabled,
    color: shadow.color,
    // Rounded to 0.1 % against float noise (e.g. 0.07 × 100).
    opacityPercent: Math.round(shadow.opacity * 1000) / 10,
    blurMm: shadow.blurMm,
    offsetXMm: shadow.offsetXMm,
    offsetYMm: shadow.offsetYMm,
  };
}

/** The shadow of form values. */
export function shadowFromFormValue(value: ShadowFormValue): Shadow {
  return {
    enabled: value.enabled,
    color: value.color,
    blurMm: value.blurMm,
    offsetXMm: value.offsetXMm,
    offsetYMm: value.offsetYMm,
    opacity: value.opacityPercent / 100,
  };
}

/**
 * "Shadow" checkbox and, only if it is checked, colour, opacity, blur and offset X/Y. The owner
 * creates the form group (e.g. with `shadowFormGroup`); `committed` is emitted when the checkbox
 * changes or a field is committed, `colorPreview` while the colour is changed in the picker.
 *
 * The fields follow the `valueChanges` of the `enabled` control. An owner that resets the group with
 * `emitEvent: false` must then emit them for that control (e.g.
 * `enabled.updateValueAndValidity({ onlySelf: true })`).
 */
@Component({
  selector: 'app-shadow-fields',
  imports: [ReactiveFormsModule, MatCheckboxModule, ColorField, NumberField],
  template: `
    @let shadow = group().controls;
    <mat-checkbox
      [formControl]="shadow.enabled"
      (change)="committed.emit()"
      i18n="@@editor.shadow.enabled"
    >
      Shadow
    </mat-checkbox>
    @if (enabled()) {
      <div class="field-row">
        <app-color-field
          class="color-cell"
          [control]="shadow.color"
          i18n-label="@@editor.shadow.color"
          label="Colour"
          (previewed)="colorPreview.emit($event)"
          (committed)="committed.emit()"
        />
        <app-number-field
          [control]="shadow.opacityPercent"
          [limits]="limits.opacityPercent"
          i18n-label="@@editor.shadow.opacityPercent"
          label="Opacity (%)"
          (committed)="committed.emit()"
        />
      </div>
      <app-number-field
        [control]="shadow.blurMm"
        [limits]="limits.blurMm"
        i18n-label="@@editor.shadow.blurMm"
        label="Blur (mm)"
        (committed)="committed.emit()"
      />
      <div class="field-row">
        <app-number-field
          [control]="shadow.offsetXMm"
          [limits]="limits.offsetMm"
          i18n-label="@@editor.shadow.offsetXMm"
          label="Offset X (mm)"
          (committed)="committed.emit()"
        />
        <app-number-field
          [control]="shadow.offsetYMm"
          [limits]="limits.offsetMm"
          i18n-label="@@editor.shadow.offsetYMm"
          label="Offset Y (mm)"
          (committed)="committed.emit()"
        />
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
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
export class ShadowFields {
  readonly group = input.required<ShadowFormGroup>();
  readonly committed = output<void>();
  /** The colour while it is changed in the picker (not committed yet). */
  readonly colorPreview = output<string>();

  protected readonly limits = SHADOW_LIMITS;

  /** Value of the `enabled` control; follows a new group instance. */
  protected readonly enabled = toSignal(
    toObservable(this.group).pipe(
      switchMap(({ controls: { enabled } }) => enabled.valueChanges.pipe(startWith(enabled.value))),
    ),
    { initialValue: false },
  );
}
