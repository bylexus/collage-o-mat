import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AdminUser, UpdateUserRequest } from '../../../core/models/admin';
import { errorMessage } from '../../../shared/error-message';
import { formatStorageLimit } from '../../../shared/storage-size';
import {
  matchesPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHARS,
  passwordRules,
} from './password-validators';
import {
  applyStorageDefault,
  storageLimitRequest,
  storageLimitRules,
  storageLimitValues,
} from './storage-limit';

/** Input of the edit user dialog. */
export interface UserEditDialogData {
  user: AdminUser;
  /** The user is the logged-in admin: admin role, active flag, password and delete are locked. */
  isSelf: boolean;
  /** Current server default of the storage limit in bytes (0 = unlimited). */
  defaultStorageBytes: number;
  /**
   * Saves the changes (done by the page). A rejected promise keeps the dialog open and shows the
   * error; on success the dialog closes with `'saved'`.
   */
  save: (request: UpdateUserRequest) => Promise<unknown>;
  /**
   * Asks for the delete confirmation and deletes the user (done by the page). Resolves `true` if
   * the user was deleted; the dialog then closes with `'deleted'`.
   */
  remove: () => Promise<boolean>;
}

/** Result of the edit user dialog; `undefined` on cancel. */
export type UserEditDialogResult = 'saved' | 'deleted';

/**
 * Edit dialog of a user: admin role, active flag, storage limit, new password (optional), delete.
 */
@Component({
  selector: 'app-user-edit-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title i18n="@@admin.edit.title">Edit user "{{ data.user.username }}"</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="dialog-fields">
        @if (data.isSelf) {
          <p class="dialog-hint" i18n="@@admin.edit.selfHint">
            This is your own account. You cannot change your admin role or active state or delete it
            here. Change your password on the Profile page.
          </p>
        }

        <div class="checkboxes">
          <mat-checkbox formControlName="isAdmin" i18n="@@admin.user.isAdmin">Admin</mat-checkbox>
          <mat-checkbox formControlName="isActive" i18n="@@admin.user.isActive"
            >Active</mat-checkbox
          >
        </div>

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

        @if (!data.isSelf) {
          <p class="dialog-hint" i18n="@@admin.edit.passwordHint">
            Leave the password fields empty to keep the current password.
          </p>

          <mat-form-field>
            <mat-label i18n="@@admin.edit.newPassword">New password</mat-label>
            <input
              matInput
              type="password"
              formControlName="newPassword"
              autocomplete="new-password"
            />
            @if (form.controls.newPassword.hasError('tooShort')) {
              <mat-error i18n="@@admin.password.tooShort"
                >The password must have at least {{ minChars }} characters</mat-error
              >
            } @else if (form.controls.newPassword.hasError('tooLong')) {
              <mat-error i18n="@@admin.password.tooLong"
                >The password is too long (max. {{ maxBytes }} bytes)</mat-error
              >
            }
          </mat-form-field>

          <mat-form-field>
            <mat-label i18n="@@admin.edit.repeatPassword">Repeat new password</mat-label>
            <input
              matInput
              type="password"
              formControlName="repeatPassword"
              autocomplete="new-password"
            />
            @if (form.controls.repeatPassword.hasError('mismatch')) {
              <mat-error i18n="@@admin.password.mismatch">The passwords do not match</mat-error>
            }
          </mat-form-field>
        }

        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>

      <mat-dialog-actions>
        <button
          matButton
          type="button"
          class="destructive"
          [disabled]="data.isSelf || saving()"
          (click)="remove()"
        >
          <mat-icon>delete</mat-icon>
          <ng-container i18n="@@admin.edit.delete">Delete</ng-container>
        </button>
        <span class="actions-spacer"></span>
        <button matButton type="button" mat-dialog-close [disabled]="saving()">
          <ng-container i18n="@@admin.dialog.cancel">Cancel</ng-container>
        </button>
        <button matButton="filled" type="submit" [disabled]="saving()">
          @if (saving()) {
            <mat-spinner class="dialog-spinner" diameter="18" />
          }
          <ng-container i18n="@@admin.edit.save">Save</ng-container>
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styleUrl: './user-dialog.scss',
})
export class UserEditDialog {
  protected readonly data = inject<UserEditDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<UserEditDialog, UserEditDialogResult>>(MatDialogRef);

  protected readonly minChars = PASSWORD_MIN_CHARS;
  protected readonly maxBytes = PASSWORD_MAX_BYTES;
  protected readonly defaultLimit = formatStorageLimit(this.data.defaultStorageBytes);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly storageStart = storageLimitValues(
    this.data.user.maxStorageBytes,
    this.data.defaultStorageBytes,
  );

  protected readonly form = inject(NonNullableFormBuilder).group({
    isAdmin: [this.data.user.isAdmin],
    isActive: [this.data.user.isActive],
    useDefaultStorage: [this.storageStart.useDefaultStorage],
    storageLimitGb: [this.storageStart.storageLimitGb, storageLimitRules],
    newPassword: ['', passwordRules],
    repeatPassword: ['', matchesPassword('newPassword')],
  });

  constructor() {
    this.lockOwnAccount();
    this.applyStorageDefault();
    this.form.controls.useDefaultStorage.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyStorageDefault());
    // The repeat check depends on the new password: check it again when the new password changes.
    this.form.controls.newPassword.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.repeatPassword.updateValueAndValidity());
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { isAdmin, isActive, useDefaultStorage, storageLimitGb, newPassword } =
      this.form.getRawValue();
    const request: UpdateUserRequest = {
      isAdmin,
      isActive,
      maxStorageBytes: storageLimitRequest(useDefaultStorage, storageLimitGb),
    };
    if (!this.data.isSelf && newPassword !== '') {
      request.newPassword = newPassword;
    }
    this.setSaving(true);
    this.error.set(null);
    try {
      await this.data.save(request);
      this.ref.close('saved');
    } catch (err) {
      this.error.set(errorMessage(err));
      this.setSaving(false);
    }
  }

  protected async remove(): Promise<void> {
    if (this.data.isSelf || this.saving()) {
      return;
    }
    this.error.set(null);
    if (await this.data.remove()) {
      this.ref.close('deleted');
    }
  }

  private setSaving(saving: boolean): void {
    this.saving.set(saving);
    this.ref.disableClose = saving;
    if (saving) {
      this.form.disable();
    } else {
      this.form.enable();
      this.lockOwnAccount();
      this.applyStorageDefault();
    }
  }

  private applyStorageDefault(): void {
    applyStorageDefault(this.form.controls, this.data.defaultStorageBytes);
  }

  /** The own account: admin role and active flag cannot be changed here. */
  private lockOwnAccount(): void {
    if (this.data.isSelf) {
      this.form.controls.isAdmin.disable();
      this.form.controls.isActive.disable();
    }
  }
}
