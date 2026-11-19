import { DatePipe } from '@angular/common';
import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormGroupDirective,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ProfileApi } from '../../core/api/profile.api';
import { AuthService } from '../../core/auth.service';
import { StorageUsage, User } from '../../core/models/user';
import { errorMessage } from '../../shared/error-message';
import { NotificationService } from '../../shared/notification.service';
import { formatGb } from '../../shared/storage-size';
import { UserAvatar } from '../../shared/user-avatar';

/** Image types the server accepts as avatar. */
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Max avatar file size (same as the server limit). */
const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
/** Password rules (same as the server): min characters (code points), max UTF-8 bytes (bcrypt). */
const PASSWORD_MIN_CHARS = 8;
const PASSWORD_MAX_BYTES = 72;

/** Profile page of the logged-in user: info, storage usage, avatar and password change. */
@Component({
  selector: 'app-profile-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    UserAvatar,
  ],
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.scss',
})
export class ProfilePage {
  private readonly api = inject(ProfileApi);
  private readonly notification = inject(NotificationService);
  protected readonly auth = inject(AuthService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly passwordForm = viewChild.required(FormGroupDirective);

  protected readonly minChars = PASSWORD_MIN_CHARS;
  protected readonly maxBytes = PASSWORD_MAX_BYTES;
  protected readonly avatarBusy = signal(false);
  protected readonly passwordBusy = signal(false);
  /** Own storage usage; `null` while loading or if it could not be loaded (then not shown). */
  private readonly storage = signal<StorageUsage | null>(null);

  /** "1.23 GB of 2 GB used" or "1.23 GB used (no limit)"; `null` = show nothing. */
  protected readonly storageText = computed(() => {
    const storage = this.storage();
    if (!storage) {
      return null;
    }
    const used = formatGb(storage.usedBytes);
    if (storage.limitBytes <= 0) {
      return $localize`:@@profile.storage.unlimited:${used}:used: used (no limit)`;
    }
    const limit = formatGb(storage.limitBytes);
    return $localize`:@@profile.storage.used:${used}:used: of ${limit}:limit: used`;
  });

  protected readonly form = inject(NonNullableFormBuilder).group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, passwordRules]],
    repeatPassword: ['', [Validators.required, matchesNewPassword]],
  });

  constructor() {
    void this.loadStorage();
    // The repeat check depends on the new password: check it again when the new password changes.
    this.form.controls.newPassword.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.repeatPassword.updateValueAndValidity());
  }

  /** Loads the storage usage; an error only hides the text (it is not important enough). */
  private async loadStorage(): Promise<void> {
    try {
      this.storage.set(await firstValueFrom(this.api.storage()));
    } catch {
      this.storage.set(null);
    }
  }

  protected chooseFile(): void {
    this.fileInput().nativeElement.click();
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!AVATAR_TYPES.includes(file.type)) {
      this.notification.error(
        $localize`:@@profile.avatar.wrongType:Please choose a JPEG, PNG or WebP image.`,
      );
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      this.notification.error(
        $localize`:@@profile.avatar.tooLarge:The image is too large. The maximum size is 10 MB.`,
      );
      return;
    }
    await this.runAvatar(
      () => firstValueFrom(this.api.uploadAvatar(file)),
      $localize`:@@profile.avatar.uploaded:Avatar saved`,
      $localize`:@@profile.avatar.uploadError:Could not save the avatar.`,
    );
  }

  protected async removeAvatar(): Promise<void> {
    await this.runAvatar(
      () => firstValueFrom(this.api.deleteAvatar()),
      $localize`:@@profile.avatar.removed:Avatar removed`,
      $localize`:@@profile.avatar.removeError:Could not remove the avatar.`,
    );
  }

  protected async changePassword(): Promise<void> {
    if (this.form.invalid || this.passwordBusy()) {
      this.form.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.passwordBusy.set(true);
    this.form.disable();
    try {
      await firstValueFrom(this.api.changePassword(currentPassword, newPassword));
      this.form.enable();
      this.passwordForm().resetForm();
      this.notification.success($localize`:@@profile.password.changed:Password changed`);
    } catch (err) {
      this.form.enable();
      this.notification.error(
        errorMessage(err, $localize`:@@profile.password.error:Could not change the password.`),
      );
    } finally {
      this.passwordBusy.set(false);
    }
  }

  private async runAvatar(
    call: () => Promise<User>,
    success: string,
    fallback: string,
  ): Promise<void> {
    if (this.avatarBusy()) {
      return;
    }
    this.avatarBusy.set(true);
    try {
      this.auth.setUser(await call());
      this.notification.success(success);
    } catch (err) {
      this.notification.error(errorMessage(err, fallback));
    } finally {
      this.avatarBusy.set(false);
    }
  }
}

/** New password: min characters (code points) and max UTF-8 bytes, like the server. */
const passwordRules: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
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

/** The repeated password must equal the new password of the same form group. */
const matchesNewPassword: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const newPassword = control.parent?.get('newPassword')?.value as string | undefined;
  return control.value && control.value !== newPassword ? { mismatch: true } : null;
};
