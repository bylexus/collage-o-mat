import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CreateUserRequest } from '../../../core/models/admin';
import { errorMessage } from '../../../shared/error-message';
import { formatStorageLimit } from '../../../shared/storage-size';
import {
  matchesPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHARS,
  passwordRules,
  USERNAME_MAX_CHARS,
  usernameRules,
} from './password-validators';
import {
  applyStorageDefault,
  storageLimitRequest,
  storageLimitRules,
  storageLimitValues,
} from './storage-limit';

/** Input of the create user dialog. */
export interface UserCreateDialogData {
  /** Current server default of the storage limit in bytes (0 = unlimited). */
  defaultStorageBytes: number;
  /**
   * Creates the user (done by the page). A rejected promise keeps the dialog open and shows the
   * error; on success the dialog closes with `true`.
   */
  save: (request: CreateUserRequest) => Promise<unknown>;
}

/**
 * "New user" dialog: username, password + repeat, admin role, storage limit. New users are active.
 */
@Component({
  selector: 'app-user-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title i18n="@@admin.create.title">New user</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="dialog-fields">
        <mat-form-field>
          <mat-label i18n="@@admin.create.username">Username</mat-label>
          <input
            matInput
            formControlName="username"
            autocomplete="off"
            [attr.maxlength]="usernameMaxChars"
            cdkFocusInitial
            required
          />
          @if (form.controls.username.hasError('required')) {
            <mat-error i18n="@@admin.create.usernameRequired">Username is required</mat-error>
          } @else if (form.controls.username.hasError('tooLong')) {
            <mat-error i18n="@@admin.create.usernameTooLong"
              >The username must have at most {{ usernameMaxChars }} characters</mat-error
            >
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label i18n="@@admin.create.password">Password</mat-label>
          <input
            matInput
            type="password"
            formControlName="password"
            autocomplete="new-password"
            required
          />
          @if (form.controls.password.hasError('required')) {
            <mat-error i18n="@@admin.create.passwordRequired">Password is required</mat-error>
          } @else if (form.controls.password.hasError('tooShort')) {
            <mat-error i18n="@@admin.password.tooShort"
              >The password must have at least {{ minChars }} characters</mat-error
            >
          } @else if (form.controls.password.hasError('tooLong')) {
            <mat-error i18n="@@admin.password.tooLong"
              >The password is too long (max. {{ maxBytes }} bytes)</mat-error
            >
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label i18n="@@admin.create.repeatPassword">Repeat password</mat-label>
          <input
            matInput
            type="password"
            formControlName="repeatPassword"
            autocomplete="new-password"
            required
          />
          @if (form.controls.repeatPassword.hasError('required')) {
            <mat-error i18n="@@admin.create.repeatRequired">Please repeat the password</mat-error>
          } @else if (form.controls.repeatPassword.hasError('mismatch')) {
            <mat-error i18n="@@admin.password.mismatch">The passwords do not match</mat-error>
          }
        </mat-form-field>

        <mat-checkbox formControlName="isAdmin" i18n="@@admin.user.isAdmin">Admin</mat-checkbox>

        <mat-checkbox formControlName="useDefaultStorage" i18n="@@admin.user.useDefaultStorage"
          >Use server default ({{ defaultLimit }})</mat-checkbox
        >
        <mat-form-field>
          <mat-label i18n="@@admin.user.storageLimit">Storage limit (GB)</mat-label>
          <input
            matInput
            type="number"
            formControlName="storageLimitGb"
            min="0"
            step="any"
            required
          />
          <mat-hint i18n="@@admin.user.storageLimitHint">0 = unlimited</mat-hint>
          @if (form.controls.storageLimitGb.hasError('required')) {
            <mat-error i18n="@@admin.user.storageLimitRequired">Enter a value</mat-error>
          } @else if (form.controls.storageLimitGb.hasError('min')) {
            <mat-error i18n="@@admin.user.storageLimitMin">Enter 0 or more</mat-error>
          }
        </mat-form-field>

        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close [disabled]="saving()">
          <ng-container i18n="@@admin.dialog.cancel">Cancel</ng-container>
        </button>
        <button matButton="filled" type="submit" [disabled]="saving()">
          @if (saving()) {
            <mat-spinner class="dialog-spinner" diameter="18" />
          }
          <ng-container i18n="@@admin.create.submit">Create</ng-container>
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styleUrl: './user-dialog.scss',
})
export class UserCreateDialog {
  private readonly data = inject<UserCreateDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<UserCreateDialog, boolean>>(MatDialogRef);

  protected readonly usernameMaxChars = USERNAME_MAX_CHARS;
  protected readonly minChars = PASSWORD_MIN_CHARS;
  protected readonly maxBytes = PASSWORD_MAX_BYTES;
  protected readonly defaultLimit = formatStorageLimit(this.data.defaultStorageBytes);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    username: ['', usernameRules],
    password: ['', [Validators.required, passwordRules]],
    repeatPassword: ['', [Validators.required, matchesPassword('password')]],
    isAdmin: [false],
    useDefaultStorage: [true],
    storageLimitGb: [
      storageLimitValues(null, this.data.defaultStorageBytes).storageLimitGb,
      storageLimitRules,
    ],
  });

  constructor() {
    this.applyStorageDefault();
    this.form.controls.useDefaultStorage.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyStorageDefault());
    // The repeat check depends on the password: check it again when the password changes.
    this.form.controls.password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.repeatPassword.updateValueAndValidity());
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { username, password, isAdmin, useDefaultStorage, storageLimitGb } =
      this.form.getRawValue();
    this.setSaving(true);
    this.error.set(null);
    try {
      await this.data.save({
        username: username.trim(),
        password,
        isAdmin,
        maxStorageBytes: storageLimitRequest(useDefaultStorage, storageLimitGb),
      });
      this.ref.close(true);
    } catch (err) {
      this.error.set(errorMessage(err));
      this.setSaving(false);
    }
  }

  private setSaving(saving: boolean): void {
    this.saving.set(saving);
    this.ref.disableClose = saving;
    if (saving) {
      this.form.disable();
    } else {
      this.form.enable();
      this.applyStorageDefault();
    }
  }

  private applyStorageDefault(): void {
    applyStorageDefault(this.form.controls, this.data.defaultStorageBytes);
  }
}
