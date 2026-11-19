import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { BorderSettings, defaultCollageSettings } from '../../../core/models/collage';
import { isPlaced, Photo } from '../../../core/models/photo';
import {
  BorderFields,
  borderFormGroup,
  borderFromForm,
  borderWithPreviewColor,
  toBorderFormValue,
} from '../fields/border-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';
import { effectiveBorder, hasBorderOverride, sameBorder } from '../photo-border';

/** Border values shown in the form for one photo. */
interface BorderFormState {
  photoId: number;
  useDefault: boolean;
  /** The own border of the photo, or the default border for a photo without one. */
  border: BorderSettings;
}

/**
 * Border of the selected photo (presentational): "Use collage default border" or an own full
 * border (type and its values). Emits committed, valid changes (`borderChange`; type changes,
 * field loses focus, picker closes, checkbox changes, Escape) and the live border while a colour
 * is changed in the picker (`borderPreview`).
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

  /** Own border of the photo; `null` = use the collage default border. */
  readonly borderChange = output<BorderSettings | null>();
  /** Own border while a colour is changed in the picker (not committed). */
  readonly borderPreview = output<BorderSettings>();

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    useDefault: [true],
    border: borderFormGroup(this.fb, defaultCollageSettings().defaultBorder),
  });

  protected readonly useDefault = toSignal(this.form.controls.useDefault.valueChanges, {
    initialValue: this.form.controls.useDefault.value,
  });

  /** Changes only when the shown border values change (not when the photo is moved). */
  private readonly formState = computed(() => borderFormState(this.photo(), this.defaultBorder()), {
    equal: sameBorderFormState,
  });

  constructor() {
    // Resets with events: the border fields follow the `type` control.
    syncFromInput(this.formState, ({ useDefault, border }) =>
      this.form.reset({ useDefault, border: toBorderFormValue(border) }),
    );
  }

  /**
   * Checked: the photo uses the default border again (`null`). Unchecked: commits the shown
   * border (the default border for a photo without an own border) as the own border.
   */
  protected commitUseDefault(): void {
    if (this.form.controls.useDefault.value) {
      this.borderChange.emit(null);
    } else {
      this.commitBorder();
    }
  }

  /**
   * Escape: commits the own border fields (no-op in the store if unchanged). Nothing with "Use
   * collage default border" checked (no own fields are shown).
   */
  protected commitPending(): void {
    if (!this.form.controls.useDefault.value) {
      this.commitBorder();
    }
  }

  /** Emits the own border with the picker colour as a preview (only if the fields are valid). */
  protected previewColor(color: string): void {
    const border = borderWithPreviewColor(
      this.form.controls.border,
      this.formState().border,
      color,
    );
    if (border) {
      this.borderPreview.emit(border);
    }
  }

  /** Emits the own border of the form; invalid fields are marked and nothing is emitted. */
  protected commitBorder(): void {
    const border = borderFromForm(this.form.controls.border, this.formState().border);
    if (!border) {
      this.form.controls.border.markAllAsTouched();
      return;
    }
    this.borderChange.emit(border);
  }
}

/**
 * Border form values of a photo: "use default" if the photo has no own border; the fields show
 * the own border, or the default border for a photo without one (the start values of an override).
 */
function borderFormState(photo: Photo, defaultBorder: BorderSettings): BorderFormState {
  const { props } = photo;
  return {
    photoId: photo.id,
    useDefault: !isPlaced(props) || !hasBorderOverride(props),
    border: isPlaced(props) ? effectiveBorder(props, defaultBorder) : defaultBorder,
  };
}

function sameBorderFormState(a: BorderFormState, b: BorderFormState): boolean {
  return a.photoId === b.photoId && a.useDefault === b.useDefault && sameBorder(a.border, b.border);
}
