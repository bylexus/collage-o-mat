import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CollageText, TextProps } from '../../../core/models/text';
import { limitValidators } from '../../../shared/number-limits';
import { ColorField } from '../fields/color-field';
import { LengthField } from '../fields/length-field';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';
import { TEXT_LIMITS } from './text-limits';

/** Values of the outline form. */
interface OutlineFormValue {
  enabled: boolean;
  color: string;
  widthMm: number;
}

/** Form values shown for one text. */
interface ShownOutline {
  id: string;
  value: OutlineFormValue;
}

/**
 * Outline of the selected text (presentational): on/off, width and colour. Every edit emits
 * `preview` with the full new props (only if all values are valid); a committed edit (field
 * loses focus, picker closes, checkbox changes, Escape) emits `propsChange`. The props are built
 * from the committed `text` input, so the other text sections keep their values.
 */
@Component({
  selector: 'app-text-outline-section',
  imports: [ReactiveFormsModule, MatCheckboxModule, ColorField, LengthField],
  templateUrl: './text-outline-section.html',
  styleUrl: './text-section.scss',
  host: {
    // Escape closes the popover and removes the fields before they can commit: commit first.
    '(keydown.escape)': 'commit()',
  },
})
export class TextOutlineSection {
  /** The selected text with its committed props. */
  readonly text = input.required<CollageText>();
  /** Display unit of the outline width with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();

  /** Props while the outline is edited (not committed). */
  readonly preview = output<TextProps>();
  readonly propsChange = output<TextProps>();

  protected readonly limits = TEXT_LIMITS;

  protected readonly form = inject(NonNullableFormBuilder).group({
    enabled: [false],
    color: [''],
    widthMm: [0, limitValidators(TEXT_LIMITS.outlineWidthMm)],
  });

  /** Current form values as a signal (also after a reset from the input). */
  private readonly formValue = signal<OutlineFormValue>(this.form.getRawValue());
  protected readonly outlineEnabled = computed(() => this.formValue().enabled);

  /** Changes only when another text is shown or the shown values change (not on a move). */
  private readonly shownOutline = computed<ShownOutline>(
    () => ({ id: this.text().id, value: toFormValue(this.text().props) }),
    { equal: sameShownOutline },
  );

  constructor() {
    syncFromInput(this.shownOutline, ({ value }) => {
      // No valueChanges event: a reset is no user edit and must not emit a preview.
      this.form.reset(value, { emitEvent: false });
      this.formValue.set(this.form.getRawValue());
    });
    this.form.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      this.formValue.set(this.form.getRawValue());
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
    const { enabled, color, widthMm } = this.form.getRawValue();
    return { ...this.text().props, outline: { enabled, color, widthMm } };
  }
}

/** Outline form values of text props. */
function toFormValue({ outline }: TextProps): OutlineFormValue {
  return { enabled: outline.enabled, color: outline.color, widthMm: outline.widthMm };
}

function sameShownOutline(a: ShownOutline, b: ShownOutline): boolean {
  return (
    a.id === b.id &&
    a.value.enabled === b.value.enabled &&
    a.value.color === b.value.color &&
    a.value.widthMm === b.value.widthMm
  );
}
