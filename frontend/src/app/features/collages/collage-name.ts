import { AbstractControl, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { COLLAGE_NAME_MAX_LENGTH } from '../../core/models/collage';

/** Like `Validators.required`, but a name with only spaces is also missing (error key `required`). */
const notBlank: ValidatorFn = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value.trim() === '' ? { required: true } : null;

/** Validators of the collage name field (create and rename dialog). */
export const collageNameValidators: ValidatorFn[] = [
  notBlank,
  Validators.maxLength(COLLAGE_NAME_MAX_LENGTH),
];
