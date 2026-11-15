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
import { NonNullableFormBuilder } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { isPlaced, Photo, PhotoAdjust } from '../../../core/models/photo';
import { isNeutralAdjust } from '../canvas/adjusted-image';
import { ColorField } from '../fields/color-field';
import { syncFromInput } from '../fields/sync-from-input';
import { ADJUST_LIMITS, DEFAULT_ADJUST, PRESET_TINT_STRENGTH, TINT_PRESETS } from './adjust-limits';

/** Adjustment values shown in the section for one photo. */
interface AdjustFormState {
  photoId: number;
  /** The adjustment of the photo, or `DEFAULT_ADJUST` for a photo without one. */
  adjust: PhotoAdjust;
}

/**
 * Adjustments of the selected photo (presentational): brightness, contrast, tint colour and
 * strength, Sepia/Greyscale presets and "Reset adjustments". Emits the committed adjustment
 * (`adjustChange`; slider released, picker closes, preset, Escape) and the live adjustment while
 * a slider moves or the tint colour is changed (`adjustPreview`, at most one per animation frame).
 */
@Component({
  selector: 'app-photo-adjust-section',
  imports: [MatButtonModule, MatIconModule, MatSliderModule, ColorField],
  templateUrl: './photo-adjust-section.html',
  styleUrl: './photo-adjust-section.scss',
  host: {
    // Escape closes the popover and removes the fields before they can commit: commit first
    // (no-op in the store if unchanged).
    '(keydown.escape)': 'commitAdjust()',
  },
})
export class PhotoAdjustSection {
  readonly photo = input.required<Photo>();

  /** Adjustment of the photo; `null` = no adjustment ("Reset adjustments"). */
  readonly adjustChange = output<PhotoAdjust | null>();
  /** Adjustment while a slider moves or the tint colour is changed (not committed). */
  readonly adjustPreview = output<PhotoAdjust>();

  protected readonly adjustLimits = ADJUST_LIMITS;
  protected readonly tintPresets = TINT_PRESETS;
  /** Slider values; follow the thumb while it moves. */
  protected readonly brightness = signal(DEFAULT_ADJUST.brightness);
  protected readonly contrast = signal(DEFAULT_ADJUST.contrast);
  protected readonly tintStrength = signal(DEFAULT_ADJUST.tintStrength);
  protected readonly tintColor = inject(NonNullableFormBuilder).control(DEFAULT_ADJUST.tintColor);

  /** True if the committed adjustment of the photo shows the original ("Reset" is disabled). */
  protected readonly adjustIsNeutral = computed(() => {
    const { props } = this.photo();
    return !isPlaced(props) || isNeutralAdjust(props.adjust);
  });

  /** Pending animation frame of the throttled adjustment preview; `null` if none. */
  private previewFrame: number | null = null;

  /** Changes only when the shown adjustment values change (not when the photo is moved). */
  private readonly formState = computed(() => adjustFormState(this.photo()), {
    equal: sameAdjustFormState,
  });

  constructor() {
    syncFromInput(this.formState, ({ adjust }) => {
      this.brightness.set(adjust.brightness);
      this.contrast.set(adjust.contrast);
      this.tintStrength.set(adjust.tintStrength);
      this.tintColor.reset(adjust.tintColor);
    });
    inject(DestroyRef).onDestroy(() => this.cancelPreview());
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
