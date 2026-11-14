import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { BorderSettings, defaultCollageSettings } from '../../../core/models/collage';
import { isPlaced, Photo, PhotoBorder } from '../../../core/models/photo';
import type { Shadow } from '../../../core/models/shadow';
import { limitValidators } from '../../../shared/number-limits';
import { BORDER_WIDTH_LIMITS, BorderFields } from '../fields/border-fields';
import {
  ShadowFields,
  shadowFormGroup,
  shadowFromFormValue,
  toShadowFormValue,
} from '../fields/shadow-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { hasBorderOverride, inheritedBorder } from '../photo-border';
import { effectiveShadow, hasShadowOverride } from '../photo-shadow';
import { sameShadow } from '../shadow';

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

/**
 * Properties of the selected photo (presentational): border ("Use collage default border" or an
 * own width and colour), shadow ("Use collage default shadow" or an own full shadow), z-order,
 * "Use as background" and delete. Emits committed, valid changes (`borderChange`, `shadowChange`)
 * and the live border or shadow while a colour is changed in the picker (`borderPreview`,
 * `shadowPreview`).
 */
@Component({
  selector: 'app-photo-properties-panel',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    BorderFields,
    ShadowFields,
  ],
  templateUrl: './photo-properties-panel.html',
  styleUrl: './photo-properties-panel.scss',
})
export class PhotoPropertiesPanel {
  readonly photo = input.required<Photo>();
  readonly defaultBorder = input.required<BorderSettings>();
  readonly defaultShadow = input.required<Shadow>();
  /** True if the photo is the bg photo and the background type is `image` (button disabled). */
  readonly isBackground = input(false);

  readonly borderChange = output<PhotoBorder>();
  /** Border while the colour is changed in the picker (not committed). */
  readonly borderPreview = output<PhotoBorder>();
  /** Own shadow of the photo; `null` = use the collage default shadow. */
  readonly shadowChange = output<Shadow | null>();
  /** Own shadow while its colour is changed in the picker (not committed). */
  readonly shadowPreview = output<Shadow>();
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

  constructor() {
    syncFromInput(this.borderFormValue, ({ useDefault, widthMm, color }) =>
      this.form.reset({ useDefault, widthMm, color }),
    );
    // Resets with events: the shadow fields follow the `enabled` control.
    syncFromInput(this.shadowFormState, ({ useDefault, shadow }) =>
      this.shadowForm.reset({ useDefault, shadow: toShadowFormValue(shadow) }),
    );
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
