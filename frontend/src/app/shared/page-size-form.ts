import { computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder } from '@angular/forms';
import { merge } from 'rxjs';
import {
  CUSTOM_PAGE_SIZE_MAX_MM,
  CUSTOM_PAGE_SIZE_MIN_MM,
  customPageSettings,
  DEFAULT_DPI,
  findFixedPreset,
  fixedPageSettings,
  isSquarePreset,
  orientedSize,
  PageOrientation,
  PagePresetId,
  PageSettings,
} from '../core/models/collage';
import { limitValidators, NumberLimits } from './number-limits';

/** Limits of a custom page side in millimetres. */
export const PAGE_SIDE_LIMITS: NumberLimits = {
  min: CUSTOM_PAGE_SIZE_MIN_MM,
  max: CUSTOM_PAGE_SIZE_MAX_MM,
  step: 0.1,
};

/** Form controls of a page size; spread them into the form group of the caller. */
export interface PageSizeControls {
  preset: FormControl<PagePresetId>;
  orientation: FormControl<PageOrientation>;
  widthMm: FormControl<number>;
  heightMm: FormControl<number>;
}

/** Page size part of a form (create dialog, editor settings panel). */
export interface PageSizeForm {
  readonly controls: PageSizeControls;
  /** The `Custom` preset is selected (free width and height). */
  readonly isCustom: Signal<boolean>;
  /** A square preset is selected (orientation has no effect). */
  readonly isSquare: Signal<boolean>;
  /** Puts the values of a page into the controls. */
  setPage(page: PageSettings): void;
  /** Page settings from the current values; call only when the controls are valid. */
  pageSettings(dpi?: number): PageSettings;
}

/**
 * Creates the page size controls with the values of `page`. The size fields follow the preset:
 * for a fixed preset they show its size in the selected orientation and are disabled (so that a
 * switch to `Custom` starts with the last size); for `Custom` they are enabled.
 *
 * Must be called in an injection context (e.g. a field initializer of a component).
 */
export function createPageSizeForm(page: PageSettings): PageSizeForm {
  const fb = inject(NonNullableFormBuilder);
  const controls: PageSizeControls = {
    preset: fb.control(page.preset),
    orientation: fb.control(page.orientation),
    widthMm: fb.control(page.widthMm, limitValidators(PAGE_SIDE_LIMITS)),
    heightMm: fb.control(page.heightMm, limitValidators(PAGE_SIDE_LIMITS)),
  };

  syncSizeWithPreset(controls);
  merge(controls.preset.valueChanges, controls.orientation.valueChanges)
    .pipe(takeUntilDestroyed())
    .subscribe(() => syncSizeWithPreset(controls));

  const preset = toSignal(controls.preset.valueChanges, { initialValue: controls.preset.value });
  const fixedPreset = computed(() => findFixedPreset(preset()));

  return {
    controls,
    isCustom: computed(() => fixedPreset() === undefined),
    isSquare: computed(() => {
      const fixed = fixedPreset();
      return fixed !== undefined && isSquarePreset(fixed);
    }),
    setPage: (next) => {
      controls.widthMm.setValue(next.widthMm, { emitEvent: false });
      controls.heightMm.setValue(next.heightMm, { emitEvent: false });
      controls.orientation.setValue(next.orientation);
      controls.preset.setValue(next.preset);
    },
    pageSettings: (dpi = DEFAULT_DPI) => {
      const preset = controls.preset.value;
      return preset === 'Custom'
        ? customPageSettings(
            { widthMm: controls.widthMm.value, heightMm: controls.heightMm.value },
            dpi,
          )
        : fixedPageSettings(preset, controls.orientation.value, dpi);
    },
  };
}

function syncSizeWithPreset({ preset, orientation, widthMm, heightMm }: PageSizeControls): void {
  const fixed = findFixedPreset(preset.value);
  if (fixed) {
    const size = orientedSize(fixed.portrait, orientation.value);
    widthMm.setValue(size.widthMm, { emitEvent: false });
    heightMm.setValue(size.heightMm, { emitEvent: false });
    widthMm.disable({ emitEvent: false });
    heightMm.disable({ emitEvent: false });
  } else {
    widthMm.enable({ emitEvent: false });
    heightMm.enable({ emitEvent: false });
  }
}
