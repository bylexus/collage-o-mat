import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { defaultCollageSettings } from '../../../core/models/collage';
import { isPlaced, Photo } from '../../../core/models/photo';
import type { Shadow } from '../../../core/models/shadow';
import {
  ShadowFields,
  shadowFormGroup,
  shadowFromFormValue,
  toShadowFormValue,
} from '../fields/shadow-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';
import { effectiveShadow, hasShadowOverride } from '../photo-shadow';
import { sameShadow } from '../shadow';

/** Shadow values shown in the form for one photo. */
interface ShadowFormState {
  photoId: number;
  useDefault: boolean;
  /** The own shadow of the photo, or the default shadow for a photo without one. */
  shadow: Shadow;
}

/**
 * Shadow of the selected photo (presentational): "Use collage default shadow" or an own full
 * shadow. Emits committed, valid changes (`shadowChange`; field loses focus, picker closes,
 * checkbox changes, Escape) and the live shadow while its colour is changed in the picker
 * (`shadowPreview`).
 */
@Component({
  selector: 'app-photo-shadow-section',
  imports: [ReactiveFormsModule, MatCheckboxModule, ShadowFields],
  templateUrl: './photo-shadow-section.html',
  styleUrl: './photo-section.scss',
  host: {
    // Escape closes the popover and removes the fields before they can commit: commit first.
    '(keydown.escape)': 'commitPending()',
  },
})
export class PhotoShadowSection {
  readonly photo = input.required<Photo>();
  readonly defaultShadow = input.required<Shadow>();
  /** Display unit of the lengths with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();

  /** Own shadow of the photo; `null` = use the collage default shadow. */
  readonly shadowChange = output<Shadow | null>();
  /** Own shadow while its colour is changed in the picker (not committed). */
  readonly shadowPreview = output<Shadow>();

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    useDefault: [true],
    shadow: shadowFormGroup(this.fb, defaultCollageSettings().defaultShadow),
  });

  protected readonly useDefault = toSignal(this.form.controls.useDefault.valueChanges, {
    initialValue: this.form.controls.useDefault.value,
  });

  /** Changes only when the shown shadow values change (not when the photo is moved). */
  private readonly formState = computed(
    () => shadowFormState(this.photo(), this.defaultShadow()),
    { equal: sameShadowFormState },
  );

  constructor() {
    // Resets with events: the shadow fields follow the `enabled` control.
    syncFromInput(this.formState, ({ useDefault, shadow }) =>
      this.form.reset({ useDefault, shadow: toShadowFormValue(shadow) }),
    );
  }

  /**
   * Checked: the photo uses the default shadow again (`null`). Unchecked: commits the shown
   * shadow (the default values for a photo without an own shadow) as the own shadow.
   */
  protected commitUseDefault(): void {
    if (this.form.controls.useDefault.value) {
      this.shadowChange.emit(null);
    } else {
      this.commitShadow();
    }
  }

  /**
   * Escape: commits the own shadow fields (no-op in the store if unchanged). Nothing with "Use
   * collage default shadow" checked (no own fields are shown).
   */
  protected commitPending(): void {
    if (!this.form.controls.useDefault.value) {
      this.commitShadow();
    }
  }

  /** Emits the own shadow with the picker colour as a preview (only if the fields are valid). */
  protected previewColor(color: string): void {
    const { shadow } = this.form.controls;
    if (shadow.valid) {
      this.shadowPreview.emit({ ...shadowFromFormValue(shadow.getRawValue()), color });
    }
  }

  /** Emits the own shadow of the form; invalid fields are marked and nothing is emitted. */
  protected commitShadow(): void {
    const { shadow } = this.form.controls;
    if (shadow.invalid) {
      shadow.markAllAsTouched();
      return;
    }
    this.shadowChange.emit(shadowFromFormValue(shadow.getRawValue()));
  }
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

function sameShadowFormState(a: ShadowFormState, b: ShadowFormState): boolean {
  return a.photoId === b.photoId && a.useDefault === b.useDefault && sameShadow(a.shadow, b.shadow);
}
