import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { BorderSettings, defaultCollageSettings } from '../../../core/models/collage';
import { isPlaced, Photo, PhotoBorder } from '../../../core/models/photo';
import { limitValidators } from '../../../shared/number-limits';
import { BORDER_WIDTH_LIMITS, BorderFields } from '../fields/border-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { hasBorderOverride, inheritedBorder } from '../photo-border';

/** Border values shown in the form for one photo. */
interface BorderFormValue {
  photoId: number;
  useDefault: boolean;
  widthMm: number;
  color: string;
}

/**
 * Properties of the selected photo (presentational): border ("Use collage default border" or an
 * own width and colour), z-order, "Use as background" and delete. Emits committed, valid changes (`borderChange`) and
 * the live border while the colour is changed in the picker (`borderPreview`).
 */
@Component({
  selector: 'app-photo-properties-panel',
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatIconModule, BorderFields],
  templateUrl: './photo-properties-panel.html',
  styleUrl: './photo-properties-panel.scss',
})
export class PhotoPropertiesPanel {
  readonly photo = input.required<Photo>();
  readonly defaultBorder = input.required<BorderSettings>();
  /** True if the photo is the bg photo and the background type is `image` (button disabled). */
  readonly isBackground = input(false);

  readonly borderChange = output<PhotoBorder>();
  /** Border while the colour is changed in the picker (not committed). */
  readonly borderPreview = output<PhotoBorder>();
  readonly bringToFront = output<void>();
  readonly sendToBack = output<void>();
  /** Make the photo the page background image. */
  readonly useAsBackground = output<void>();
  readonly delete = output<void>();

  private readonly defaults = defaultCollageSettings().defaultBorder;
  protected readonly form = inject(NonNullableFormBuilder).group({
    useDefault: [true],
    widthMm: [this.defaults.widthMm, limitValidators(BORDER_WIDTH_LIMITS)],
    color: [this.defaults.color],
  });

  protected readonly useDefault = toSignal(this.form.controls.useDefault.valueChanges, {
    initialValue: this.form.controls.useDefault.value,
  });

  /** Changes only when the shown values change (not when the photo is moved). */
  private readonly borderFormValue = computed(
    () => borderFormValue(this.photo(), this.defaultBorder()),
    { equal: sameFormValue },
  );

  constructor() {
    syncFromInput(this.borderFormValue, ({ useDefault, widthMm, color }) =>
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
