import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TextFieldModule } from '@angular/cdk/text-field';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  CollageText,
  TEXT_FONT_FAMILIES,
  TextAlign,
  TextFontFamily,
  TextProps,
} from '../../../core/models/text';
import { limitValidators } from '../../../shared/number-limits';
import { ColorField } from '../fields/color-field';
import { LengthField } from '../fields/length-field';
import { NumberField } from '../fields/number-field';
import {
  shadowFormGroup,
  ShadowFields,
  ShadowFormValue,
  shadowFromFormValue,
  toShadowFormValue,
} from '../fields/shadow-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';
import { TEXT_LIMITS } from './text-limits';

/** Font styles of the bold/italic toggle group. */
type FontStyle = 'bold' | 'italic';

/** Values of the text form: all text props except the box geometry and `z`. */
interface TextFormValue {
  text: string;
  fontFamily: TextFontFamily;
  fontSizePt: number;
  color: string;
  styles: FontStyle[];
  align: TextAlign;
  shadow: ShadowFormValue;
  outline: { enabled: boolean; color: string; widthMm: number };
}

/** Form values shown for one text. */
interface ShownText {
  id: string;
  value: TextFormValue;
}

/**
 * Properties of the selected text (presentational): text, font, size, colour, bold/italic,
 * alignment, shadow, outline, z-order and delete. Every edit emits `preview` with the full new
 * props (only if all values are valid); a committed edit (field loses focus, picker closes,
 * checkbox/select/toggle changes) emits `propsChange`. The form is reset from the input only
 * when another text is shown or its committed values change, so its own previews do not reset
 * the typing.
 */
@Component({
  selector: 'app-text-properties-panel',
  imports: [
    ReactiveFormsModule,
    TextFieldModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ColorField,
    LengthField,
    NumberField,
    ShadowFields,
  ],
  templateUrl: './text-properties-panel.html',
  styleUrl: './text-properties-panel.scss',
})
export class TextPropertiesPanel {
  readonly text = input.required<CollageText>();
  /** Display unit of the lengths (outline width, shadow) with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();

  /** Props while the text is edited (not committed). */
  readonly preview = output<TextProps>();
  readonly propsChange = output<TextProps>();
  readonly bringToFront = output<void>();
  readonly sendToBack = output<void>();
  readonly delete = output<void>();

  protected readonly limits = TEXT_LIMITS;
  protected readonly fontFamilies = TEXT_FONT_FAMILIES;

  private readonly textArea = viewChild.required<ElementRef<HTMLTextAreaElement>>('textArea');

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    text: [''],
    fontFamily: this.fb.control<TextFontFamily>('Inter'),
    fontSizePt: [0, limitValidators(TEXT_LIMITS.fontSizePt)],
    color: [''],
    styles: this.fb.control<FontStyle[]>([]),
    align: this.fb.control<TextAlign>('center'),
    shadow: shadowFormGroup(this.fb, {
      enabled: false,
      color: '',
      blurMm: 0,
      offsetXMm: 0,
      offsetYMm: 0,
      opacity: 0,
    }),
    outline: this.fb.group({
      enabled: [false],
      color: [''],
      widthMm: [0, limitValidators(TEXT_LIMITS.outlineWidthMm)],
    }),
  });

  /** Current form values as a signal (also after a reset from the input). */
  private readonly formValue = signal<TextFormValue>(this.form.getRawValue());
  protected readonly outlineEnabled = computed(() => this.formValue().outline.enabled);
  protected readonly fontFamily = computed(() => this.formValue().fontFamily);

  /** Changes only when another text is shown or the shown values change (not on a move). */
  private readonly shownText = computed<ShownText>(
    () => ({ id: this.text().id, value: toFormValue(this.text().props) }),
    { equal: sameShownText },
  );

  constructor() {
    syncFromInput(this.shownText, ({ value }) => {
      // No valueChanges event: a reset is no user edit and must not emit a preview.
      this.form.reset(value, { emitEvent: false });
      // Only for the shadow fields (they follow this control); the form emits no event.
      this.form.controls.shadow.controls.enabled.updateValueAndValidity({ onlySelf: true });
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

  /** Focuses the text area and selects its text (after "Add text" or a double-click on the canvas). */
  focusText(): void {
    const textArea = this.textArea().nativeElement;
    textArea.focus();
    textArea.select();
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

  /** The props of the shown text with the form values; `null` if a value is invalid. */
  private validProps(): TextProps | null {
    return this.form.valid ? applyFormValue(this.text().props, this.form.getRawValue()) : null;
  }
}

/** Form values of text props. */
function toFormValue(props: TextProps): TextFormValue {
  const { shadow, outline } = props;
  const styles: FontStyle[] = [];
  if (props.bold) {
    styles.push('bold');
  }
  if (props.italic) {
    styles.push('italic');
  }
  return {
    text: props.text,
    fontFamily: props.fontFamily,
    fontSizePt: props.fontSizePt,
    color: props.color,
    styles,
    align: props.align,
    shadow: toShadowFormValue(shadow),
    outline: { enabled: outline.enabled, color: outline.color, widthMm: outline.widthMm },
  };
}

/** `base` (box geometry and z) with the form values. */
function applyFormValue(base: TextProps, value: TextFormValue): TextProps {
  const { shadow, outline } = value;
  return {
    ...base,
    text: value.text,
    fontFamily: value.fontFamily,
    fontSizePt: value.fontSizePt,
    color: value.color,
    bold: value.styles.includes('bold'),
    italic: value.styles.includes('italic'),
    align: value.align,
    shadow: shadowFromFormValue(shadow),
    outline: { enabled: outline.enabled, color: outline.color, widthMm: outline.widthMm },
  };
}

/**
 * True for the same text with the same form values. The values are compared as JSON: both are
 * built by `toFormValue`, so the key order is the same.
 */
function sameShownText(a: ShownText, b: ShownText): boolean {
  return a.id === b.id && JSON.stringify(a.value) === JSON.stringify(b.value);
}
