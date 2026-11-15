import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { BorderSettings, defaultCollageSettings } from '../../../core/models/collage';
import { isPlaced, Photo, PhotoBorder } from '../../../core/models/photo';
import { limitValidators } from '../../../shared/number-limits';
import { BORDER_WIDTH_LIMITS, BorderFields } from '../fields/border-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';
import { hasBorderOverride, inheritedBorder } from '../photo-border';

/** Border values shown in the form for one photo. */
interface BorderFormValue {
  photoId: number;
  useDefault: boolean;
  widthMm: number;
  color: string;
}

/**
 * Border of the selected photo (presentational): "Use collage default border" or an own width
 * and colour. Emits committed, valid changes (`borderChange`; field loses focus, picker closes,
 * checkbox changes, Escape) and the live border while the colour is changed in the picker
 * (`borderPreview`).
 */
@Component({
  selector: 'app-photo-border-section',
  imports: [ReactiveFormsModule, MatCheckboxModule, BorderFields],
  templateUrl: './photo-border-section.html',
  styleUrl: './photo-section.scss',
  host: {
    // Escape closes the popover and removes the fields before they can commit: commit first.
    '(keydown.escape)': 'commitPending()',
  },
})
export class PhotoBorderSection {
  readonly photo = input.required<Photo>();
  readonly defaultBorder = input.required<BorderSettings>();
  /** Display unit of the lengths with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();

  readonly borderChange = output<PhotoBorder>();
  /** Border while the colour is changed in the picker (not committed). */
  readonly borderPreview = output<PhotoBorder>();

  private readonly defaults = defaultCollageSettings();
  protected readonly form = inject(NonNullableFormBuilder).group({
    useDefault: [true],
    widthMm: [this.defaults.defaultBorder.widthMm, limitValidators(BORDER_WIDTH_LIMITS)],
    color: [this.defaults.defaultBorder.color],
  });

  protected readonly useDefault = toSignal(this.form.controls.useDefault.valueChanges, {
    initialValue: this.form.controls.useDefault.value,
  });

  /** Changes only when the shown values change (not when the photo is moved). */
  private readonly formValue = computed(() => borderFormValue(this.photo(), this.defaultBorder()), {
    equal: sameFormValue,
  });

  constructor() {
    syncFromInput(this.formValue, ({ useDefault, widthMm, color }) =>
      this.form.reset({ useDefault, widthMm, color }),
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

  /**
   * Escape: commits an own width or colour that differs from the shown values. Unchanged fields
   * are not committed, so a partial override is not made a full one without an edit.
   */
  protected commitPending(): void {
    const shown = this.formValue();
    const { useDefault, widthMm, color } = this.form.getRawValue();
    if (!useDefault && (widthMm !== shown.widthMm || color !== shown.color)) {
      this.commitBorder();
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

function sameFormValue(a: BorderFormValue, b: BorderFormValue): boolean {
  return (
    a.photoId === b.photoId &&
    a.useDefault === b.useDefault &&
    a.widthMm === b.widthMm &&
    a.color === b.color
  );
}
