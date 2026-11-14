import {
  ChangeDetectorRef,
  Component,
  computed,
  DoCheck,
  inject,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { limitValidators, NumberLimits } from '../../../shared/number-limits';
import {
  fromDisplayLength,
  lengthLabel,
  LengthUnit,
  toDisplayLength,
  toDisplayLimits,
} from '../geometry/length-unit';
import { clamp } from '../geometry/numbers';
import { NumberField } from './number-field';

/** Error key on the mm control while the shown value is invalid (the mm value is not changed). */
const DISPLAY_ERROR = 'lengthDisplay';

/**
 * Length field (`app-number-field`) in the display unit of the editor. The owner's `control` holds
 * the length in mm and stays the source of truth: the field shows its value in `lengthUnit`
 * (mm unchanged, or whole px at the DPI) and follows each change of the value, the unit and the
 * DPI, also changes made with `emitEvent: false`. A valid input is written to `control` in mm
 * (`setValue`); an invalid input keeps the mm value and makes `control` invalid (error
 * `lengthDisplay`). The label gets the unit (e.g. "Width (px)"); range errors show the limits in
 * the display unit. Emits `committed` like `app-number-field`.
 */
@Component({
  selector: 'app-length-field',
  imports: [NumberField],
  template: `
    <app-number-field
      [control]="display"
      [limits]="displayLimits()"
      [label]="unitLabel()"
      (committed)="committed.emit()"
    />
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class LengthField implements DoCheck {
  /** The length in mm (with the validators of `limits`). */
  readonly control = input.required<FormControl<number>>();
  /** Label without the unit. */
  readonly label = input.required<string>();
  /** Limits in mm. */
  readonly limits = input.required<NumberLimits>();
  readonly lengthUnit = input.required<LengthUnit>();
  readonly committed = output<void>();

  protected readonly displayLimits = computed(() =>
    toDisplayLimits(this.limits(), this.lengthUnit()),
  );
  protected readonly unitLabel = computed(() => lengthLabel(this.label(), this.lengthUnit()));

  /** The shown value in the display unit. */
  protected readonly display = new FormControl<number | null>(null);

  private readonly changeDetector = inject(ChangeDetectorRef);
  /** State of the last sync from `control` to `display` (`undefined` before the first one). */
  private synced:
    { control: FormControl<number>; mm: number | null; lengthUnit: LengthUnit } | undefined;
  private syncedLimits: NumberLimits | undefined;
  /** The user entered an invalid value, so `control` got the `lengthDisplay` error. */
  private inputInvalid = false;

  constructor() {
    this.display.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.writeToControl(value));
  }

  /**
   * Shows the mm value again when the control, its value, the unit or the DPI changed, or when the
   * control lost the `lengthDisplay` error (e.g. a reset by the owner). Runs on each change
   * detection of the owner, because a `setValue` with `emitEvent: false` emits no event.
   */
  ngDoCheck(): void {
    const control = this.control();
    const lengthUnit = this.lengthUnit();
    const limits = this.displayLimits();
    let changed = false;

    if (limits !== this.syncedLimits) {
      this.syncedLimits = limits;
      this.display.setValidators(limitValidators(limits));
      this.display.updateValueAndValidity({ emitEvent: false });
      changed = true;
    }

    const synced = this.synced;
    const mustSync =
      !synced ||
      synced.control !== control ||
      synced.mm !== control.value ||
      synced.lengthUnit.unit !== lengthUnit.unit ||
      synced.lengthUnit.dpi !== lengthUnit.dpi ||
      (this.inputInvalid && !control.hasError(DISPLAY_ERROR));
    if (mustSync) {
      this.syncFromControl(control, lengthUnit);
      changed = true;
    }

    if (control.disabled !== this.display.disabled) {
      if (control.disabled) {
        this.display.disable({ emitEvent: false });
      } else {
        this.display.enable({ emitEvent: false });
      }
      changed = true;
    }
    if (control.touched && !this.display.touched) {
      this.display.markAsTouched();
      changed = true;
    }

    if (changed) {
      this.changeDetector.markForCheck();
    }
  }

  /** Shows the mm value of `control` in the display unit; removes a `lengthDisplay` error. */
  private syncFromControl(control: FormControl<number>, lengthUnit: LengthUnit): void {
    const mm = control.value as number | null;
    this.display.setValue(mm === null ? null : toDisplayLength(mm, lengthUnit), {
      emitEvent: false,
    });
    if (control.touched) {
      this.display.markAsTouched();
    } else {
      this.display.markAsUntouched();
    }
    if (control.hasError(DISPLAY_ERROR)) {
      control.updateValueAndValidity({ emitEvent: false });
    }
    this.inputInvalid = false;
    this.synced = { control, mm, lengthUnit };
  }

  /**
   * User input: a valid value is written to `control` in mm (px: rounded to 3 decimals, then
   * clamped into the mm limits, because a px value at a rounded px limit can be a bit outside
   * them); an invalid or empty value keeps the mm value and sets the `lengthDisplay` error.
   */
  private writeToControl(value: number | null): void {
    const control = this.control();
    if (value === null || this.display.invalid) {
      control.setErrors({ ...control.errors, [DISPLAY_ERROR]: true });
      this.inputInvalid = true;
      return;
    }
    const { min, max } = this.limits();
    const mm = clamp(fromDisplayLength(value, this.lengthUnit()), min, max);
    control.setValue(mm);
    this.inputInvalid = false;
    this.synced = { control, mm, lengthUnit: this.lengthUnit() };
  }
}
