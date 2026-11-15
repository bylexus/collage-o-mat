import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  WritableSignal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { BorderSettings, defaultCollageSettings } from '../../../core/models/collage';
import { isPlaced, Photo, PhotoAdjust, PhotoBorder } from '../../../core/models/photo';
import type { Shadow } from '../../../core/models/shadow';
import { limitValidators } from '../../../shared/number-limits';
import { isNeutralAdjust } from '../canvas/adjusted-image';
import { BORDER_WIDTH_LIMITS, BorderFields } from '../fields/border-fields';
import { ColorField } from '../fields/color-field';
import {
  ShadowFields,
  shadowFormGroup,
  shadowFromFormValue,
  toShadowFormValue,
} from '../fields/shadow-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';
import { hasBorderOverride, inheritedBorder } from '../photo-border';
import { effectiveShadow, hasShadowOverride } from '../photo-shadow';
import { sameShadow } from '../shadow';
import { ADJUST_LIMITS, DEFAULT_ADJUST, PRESET_TINT_STRENGTH, TINT_PRESETS } from './adjust-limits';

/** Border values shown in the form for one photo. */
interface BorderFormValue {
  photoId: number;
  useDefault: boolean;
  widthMm: number;
  color: string;
}

/** Shadow values shown in the form for one photo. */
interface ShadowFormState {
  photoId: number;
  useDefault: boolean;
  /** The own shadow of the photo, or the default shadow for a photo without one. */
  shadow: Shadow;
}

/** Adjustment values shown in the section for one photo. */
interface AdjustFormState {
  photoId: number;
  /** The adjustment of the photo, or `DEFAULT_ADJUST` for a photo without one. */
  adjust: PhotoAdjust;
}

/**
 * Properties of the selected photo (presentational): border ("Use collage default border" or an
 * own width and colour), shadow ("Use collage default shadow" or an own full shadow), adjustments
 * (brightness, contrast, tint), z-order, "Use as background" and delete. Emits committed, valid
 * changes (`borderChange`, `shadowChange`, `adjustChange`), the live border or shadow while a
 * colour is changed in the picker (`borderPreview`, `shadowPreview`) and the live adjustment while
 * a slider moves or the tint colour is changed (`adjustPreview`, at most one per animation frame).
 */
@Component({
  selector: 'app-photo-properties-panel',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatSliderModule,
    BorderFields,
    ColorField,
    ShadowFields,
  ],
  templateUrl: './photo-properties-panel.html',
  styleUrl: './photo-properties-panel.scss',
})
export class PhotoPropertiesPanel {
  readonly photo = input.required<Photo>();
  readonly defaultBorder = input.required<BorderSettings>();
  readonly defaultShadow = input.required<Shadow>();
  /** Display unit of the lengths with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();
  /** True if the photo is the bg photo and the background type is `image` (button disabled). */
  readonly isBackground = input(false);

  readonly borderChange = output<PhotoBorder>();
  /** Border while the colour is changed in the picker (not committed). */
  readonly borderPreview = output<PhotoBorder>();
  /** Own shadow of the photo; `null` = use the collage default shadow. */
  readonly shadowChange = output<Shadow | null>();
  /** Own shadow while its colour is changed in the picker (not committed). */
  readonly shadowPreview = output<Shadow>();
  /** Adjustment of the photo; `null` = no adjustment ("Reset adjustments"). */
  readonly adjustChange = output<PhotoAdjust | null>();
  /** Adjustment while a slider moves or the tint colour is changed (not committed). */
  readonly adjustPreview = output<PhotoAdjust>();
  readonly bringToFront = output<void>();
  readonly sendToBack = output<void>();
  /** Make the photo the page background image. */
  readonly useAsBackground = output<void>();
  readonly delete = output<void>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly defaults = defaultCollageSettings();
  protected readonly form = this.fb.group({
    useDefault: [true],
    widthMm: [this.defaults.defaultBorder.widthMm, limitValidators(BORDER_WIDTH_LIMITS)],
    color: [this.defaults.defaultBorder.color],
  });
  protected readonly shadowForm = this.fb.group({
    useDefault: [true],
    shadow: shadowFormGroup(this.fb, this.defaults.defaultShadow),
  });

  protected readonly adjustLimits = ADJUST_LIMITS;
  protected readonly tintPresets = TINT_PRESETS;
  /** Slider values; follow the thumb while it moves. */
  protected readonly brightness = signal(DEFAULT_ADJUST.brightness);
  protected readonly contrast = signal(DEFAULT_ADJUST.contrast);
  protected readonly tintStrength = signal(DEFAULT_ADJUST.tintStrength);
  protected readonly tintColor = this.fb.control(DEFAULT_ADJUST.tintColor);

  /** True if the committed adjustment of the photo shows the original ("Reset" is disabled). */
  protected readonly adjustIsNeutral = computed(() => {
    const { props } = this.photo();
    return !isPlaced(props) || isNeutralAdjust(props.adjust);
  });

  /** Pending animation frame of the throttled adjustment preview; `null` if none. */
  private previewFrame: number | null = null;

  protected readonly useDefault = toSignal(this.form.controls.useDefault.valueChanges, {
    initialValue: this.form.controls.useDefault.value,
  });
  protected readonly useDefaultShadow = toSignal(this.shadowForm.controls.useDefault.valueChanges, {
    initialValue: this.shadowForm.controls.useDefault.value,
  });

  /** Changes only when the shown values change (not when the photo is moved). */
  private readonly borderFormValue = computed(
    () => borderFormValue(this.photo(), this.defaultBorder()),
    { equal: sameFormValue },
  );

  /** Changes only when the shown shadow values change (not when the photo is moved). */
  private readonly shadowFormState = computed(
    () => shadowFormState(this.photo(), this.defaultShadow()),
    { equal: sameShadowFormState },
  );

  /** Changes only when the shown adjustment values change (not when the photo is moved). */
  private readonly adjustFormState = computed(() => adjustFormState(this.photo()), {
    equal: sameAdjustFormState,
  });

  constructor() {
    syncFromInput(this.borderFormValue, ({ useDefault, widthMm, color }) =>
      this.form.reset({ useDefault, widthMm, color }),
    );
    // Resets with events: the shadow fields follow the `enabled` control.
    syncFromInput(this.shadowFormState, ({ useDefault, shadow }) =>
      this.shadowForm.reset({ useDefault, shadow: toShadowFormValue(shadow) }),
    );
    syncFromInput(this.adjustFormState, ({ adjust }) => {
      this.brightness.set(adjust.brightness);
      this.contrast.set(adjust.contrast);
      this.tintStrength.set(adjust.tintStrength);
      this.tintColor.reset(adjust.tintColor);
    });
    inject(DestroyRef).onDestroy(() => this.cancelPreview());
  }

  protected commitUseDefault(): void {
    if (this.form.controls.useDefault.value) {
      this.borderChange.emit(inheritedBorder());
    } else {
      this.commitBorder();
    }
  }

  protected previewColor(color: string): void {
    const { widthMm } = this.form.controls;
    if (widthMm.valid) {
      this.borderPreview.emit({ widthMm: widthMm.value, color });
    }
  }

  protected commitBorder(): void {
    const { widthMm, color } = this.form.controls;
    if (widthMm.invalid) {
      widthMm.markAsTouched();
      return;
    }
    this.borderChange.emit({ widthMm: widthMm.value, color: color.value });
  }

  /**
   * Checked: the photo uses the default shadow again (`null`). Unchecked: commits the shown
   * shadow (the default values for a photo without an own shadow) as the own shadow.
   */
  protected commitUseDefaultShadow(): void {
    if (this.shadowForm.controls.useDefault.value) {
      this.shadowChange.emit(null);
    } else {
      this.commitShadow();
    }
  }

  /** Emits the own shadow with the picker colour as a preview (only if the fields are valid). */
  protected previewShadowColor(color: string): void {
    const { shadow } = this.shadowForm.controls;
    if (shadow.valid) {
      this.shadowPreview.emit({ ...shadowFromFormValue(shadow.getRawValue()), color });
    }
  }

  /** Emits the own shadow of the form; invalid fields are marked and nothing is emitted. */
  protected commitShadow(): void {
    const { shadow } = this.shadowForm.controls;
    if (shadow.invalid) {
      shadow.markAllAsTouched();
      return;
    }
    this.shadowChange.emit(shadowFromFormValue(shadow.getRawValue()));
  }

  /** An adjustment slider thumb moves: shows the value and previews it (committed on release). */
  protected previewSlider(value: WritableSignal<number>, event: Event): void {
    value.set((event.target as HTMLInputElement).valueAsNumber);
    this.schedulePreview();
  }

  /**
   * Emits `adjustPreview` in the next animation frame with the values shown then (at most one
   * preview per frame; later calls in the same frame are merged). Dropped if another photo is
   * shown by then.
   */
  protected schedulePreview(): void {
    if (this.previewFrame !== null) {
      return;
    }
    const photoId = this.photo().id;
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = null;
      if (this.photo().id === photoId) {
        this.adjustPreview.emit(this.formAdjust());
      }
    });
  }

  /** Emits the shown adjustment (a pending preview is cancelled). */
  protected commitAdjust(): void {
    this.cancelPreview();
    this.adjustChange.emit(this.formAdjust());
  }

  /** Sepia/Greyscale: sets the tint colour (and full strength if the strength is 0) and commits. */
  protected applyTintPreset(color: string): void {
    this.tintColor.setValue(color);
    if (this.tintStrength() === 0) {
      this.tintStrength.set(PRESET_TINT_STRENGTH);
    }
    this.commitAdjust();
  }

  /** "Reset adjustments": the photo shows the original image again. */
  protected resetAdjust(): void {
    this.cancelPreview();
    this.adjustChange.emit(null);
  }

  private cancelPreview(): void {
    if (this.previewFrame !== null) {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }
  }

  /** The adjustment of the sliders and the tint colour field. */
  private formAdjust(): PhotoAdjust {
    return {
      brightness: this.brightness(),
      contrast: this.contrast(),
      tintColor: this.tintColor.value,
      tintStrength: this.tintStrength(),
    };
  }
}

/**
 * Form values of a photo: "use default" if the photo has no own border; the fields show the own
 * values, missing ones are filled from the default border (so a partial override is shown as an
 * own border with the default for the missing value).
 */
function borderFormValue(photo: Photo, defaultBorder: BorderSettings): BorderFormValue {
  const border = isPlaced(photo.props) ? photo.props.border : inheritedBorder();
  return {
    photoId: photo.id,
    useDefault: !hasBorderOverride(border),
    widthMm: border.widthMm ?? defaultBorder.widthMm,
    color: border.color ?? defaultBorder.color,
  };
}

/**
 * Shadow form values of a photo: "use default" if the photo has no own shadow; the fields show
 * the own shadow, or the default shadow for a photo without one (the start values of an override).
 */
function shadowFormState(photo: Photo, defaultShadow: Shadow): ShadowFormState {
  const { props } = photo;
  return {
    photoId: photo.id,
    useDefault: !isPlaced(props) || !hasShadowOverride(props),
    shadow: isPlaced(props) ? effectiveShadow(props, defaultShadow) : defaultShadow,
  };
}

/** Adjustment values of a photo: its own adjustment, or the defaults for a photo without one. */
function adjustFormState(photo: Photo): AdjustFormState {
  const { props } = photo;
  const adjust = isPlaced(props) ? props.adjust : null;
  return { photoId: photo.id, adjust: adjust ?? DEFAULT_ADJUST };
}

function sameAdjustFormState(a: AdjustFormState, b: AdjustFormState): boolean {
  return (
    a.photoId === b.photoId &&
    a.adjust.brightness === b.adjust.brightness &&
    a.adjust.contrast === b.adjust.contrast &&
    a.adjust.tintColor === b.adjust.tintColor &&
    a.adjust.tintStrength === b.adjust.tintStrength
  );
}

function sameShadowFormState(a: ShadowFormState, b: ShadowFormState): boolean {
  return a.photoId === b.photoId && a.useDefault === b.useDefault && sameShadow(a.shadow, b.shadow);
}

function sameFormValue(a: BorderFormValue, b: BorderFormValue): boolean {
  return (
    a.photoId === b.photoId &&
    a.useDefault === b.useDefault &&
    a.widthMm === b.widthMm &&
    a.color === b.color
  );
}
