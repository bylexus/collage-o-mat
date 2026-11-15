import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Password rules (same as the server): min characters (code points), max UTF-8 bytes (bcrypt). */
export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 72;
/** Max username length in characters (code points, same as the server). */
export const USERNAME_MAX_CHARS = 64;

/** Password: min characters and max UTF-8 bytes, like the server. An empty value is valid. */
export const passwordRules: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value as string;
  if (!value) {
    return null;
  }
  if (Array.from(value).length < PASSWORD_MIN_CHARS) {
    return { tooShort: true };
  }
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) {
    return { tooLong: true };
  }
  return null;
};

/**
 * The repeat field must equal the sibling control `passwordControl` of the same form group (both
 * empty is valid). The caller re-checks the repeat field when the password changes.
 */
export function matchesPassword(passwordControl: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const password = (control.parent?.get(passwordControl)?.value as string | undefined) ?? '';
    return control.value !== password ? { mismatch: true } : null;
  };
}

/** Username: trimmed not empty and at most `USERNAME_MAX_CHARS` characters, like the server. */
export const usernameRules: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = ((control.value as string) ?? '').trim();
  if (!value) {
    return { required: true };
  }
  return Array.from(value).length > USERNAME_MAX_CHARS ? { tooLong: true } : null;
};
