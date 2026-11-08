import { AbstractControl, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';

/** Allowed range of a numeric form field; `step` is the increment of the input spinner. */
export interface NumberLimits {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Only whole numbers are valid (error key `integer`). */
  readonly integer?: boolean;
}

/** Fails for a number with decimals; an empty value is valid (use `Validators.required`). */
const integerValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value: unknown = control.value;
  return typeof value === 'number' && !Number.isInteger(value) ? { integer: true } : null;
};

/**
 * Validators for a numeric field with the given limits. With `optional`, an empty value (`null`)
 * is valid.
 */
export function limitValidators(
  limits: NumberLimits,
  { optional = false }: { optional?: boolean } = {},
): ValidatorFn[] {
  return [
    ...(optional ? [] : [Validators.required]),
    Validators.min(limits.min),
    Validators.max(limits.max),
    ...(limits.integer ? [integerValidator] : []),
  ];
}
