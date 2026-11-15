import { Component, computed, DestroyRef, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CollageText, TextProps } from '../../../core/models/text';
import {
  shadowFormGroup,
  ShadowFields,
  ShadowFormValue,
  shadowFromFormValue,
  toShadowFormValue,
} from '../fields/shadow-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';

/** Form values shown for one text. */
interface ShownShadow {
  id: string;
  value: ShadowFormValue;
}

/**
 * Shadow of the selected text (presentational). Every edit emits `preview` with the full new
 * props (only if all values are valid); a committed edit (field loses focus, picker closes,
 * checkbox changes, Escape) emits `propsChange`. The props are built from the committed `text`
 * input, so the other text sections keep their values.
 */
@Component({
  selector: 'app-text-shadow-section',
  imports: [ReactiveFormsModule, ShadowFields],
  templateUrl: './text-shadow-section.html',
  styleUrl: './text-section.scss',
  host: {
    // Escape closes the popover and removes the fields before they can commit: commit first.
    '(keydown.escape)': 'commit()',
  },
})
export class TextShadowSection {
  /** The selected text with its committed props. */
  readonly text = input.required<CollageText>();
  /** Display unit of the blur and offset with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();

  /** Props while the shadow is edited (not committed). */
  readonly preview = output<TextProps>();
  readonly propsChange = output<TextProps>();

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    shadow: shadowFormGroup(this.fb, {
      enabled: false,
      color: '',
      blurMm: 0,
      offsetXMm: 0,
      offsetYMm: 0,
      opacity: 0,
    }),
  });

  /** Changes only when another text is shown or the shown values change (not on a move). */
  private readonly shownShadow = computed<ShownShadow>(
    () => ({ id: this.text().id, value: toShadowFormValue(this.text().props.shadow) }),
    { equal: sameShownShadow },
  );

  constructor() {
    syncFromInput(this.shownShadow, ({ value }) => {
      // No valueChanges event: a reset is no user edit and must not emit a preview.
      this.form.reset({ shadow: value }, { emitEvent: false });
      // Only for the shadow fields (they follow this control); the form emits no event.
      this.form.controls.shadow.controls.enabled.updateValueAndValidity({ onlySelf: true });
    });
    this.form.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      const props = this.validProps();
      if (props) {
        this.preview.emit(props);
      }
    });
  }

  /** Emits the form values as committed props; invalid values show their error instead. */
  protected commit(): void {
    const props = this.validProps();
    if (props) {
      this.propsChange.emit(props);
    } else {
      this.form.markAllAsTouched();
    }
  }

  /** The committed props of the shown text with the form values; `null` if a value is invalid. */
  private validProps(): TextProps | null {
    if (!this.form.valid) {
      return null;
    }
    const shadow = shadowFromFormValue(this.form.controls.shadow.getRawValue());
    return { ...this.text().props, shadow };
  }
}

/**
 * True for the same text with the same form values. The values are compared as JSON: both are
 * built by `toShadowFormValue`, so the key order is the same.
 */
function sameShownShadow(a: ShownShadow, b: ShownShadow): boolean {
  return a.id === b.id && JSON.stringify(a.value) === JSON.stringify(b.value);
}
