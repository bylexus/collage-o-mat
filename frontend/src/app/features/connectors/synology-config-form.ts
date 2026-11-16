import { Component, input } from '@angular/core';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SynologyPublicConfig } from '../../core/models/connector';

/** Form group of the Synology config; its value is a `SynologyConfigInput`. */
export type SynologyConfigGroup = FormGroup<{
  url: FormControl<string>;
  account: FormControl<string>;
  password: FormControl<string>;
  skipTlsVerify: FormControl<boolean>;
}>;

/** Rough client-side check; the backend validates the URL fully. */
const HTTP_URL_PATTERN = /^https?:\/\/[^\s/?#]+\S*$/i;

/**
 * Creates the Synology config form group. With `current` (edit), URL, account and TLS option are
 * prefilled and the password is optional if one is stored (empty = keep the stored password).
 */
export function createSynologyConfigGroup(
  fb: NonNullableFormBuilder,
  current?: SynologyPublicConfig,
): SynologyConfigGroup {
  return fb.group({
    url: [current?.url ?? '', [Validators.required, Validators.pattern(HTTP_URL_PATTERN)]],
    account: [current?.account ?? '', [Validators.required]],
    password: ['', current?.passwordSet ? [] : [Validators.required]],
    skipTlsVerify: [current?.skipTlsVerify ?? false],
  });
}

/** Type-specific fields of a Synology connector (presentational; the parent owns the group). */
@Component({
  selector: 'app-synology-config-form',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatCheckboxModule],
  template: `
    <p class="form-note" i18n="@@connectors.synology.accountNote">
      Synology Photos on DSM 7. Use a dedicated NAS account without 2-factor authentication that can
      only read photos.
    </p>

    <mat-form-field>
      <mat-label i18n="@@connectors.synology.url">NAS URL</mat-label>
      <input
        matInput
        type="url"
        [formControl]="group().controls.url"
        placeholder="https://nas.example.com:5001"
        autocomplete="url"
        required
      />
      <mat-hint i18n="@@connectors.synology.urlHint">
        The DSM address of the NAS. A path such as /photo is removed.
      </mat-hint>
      @if (group().controls.url.hasError('required')) {
        <mat-error i18n="@@connectors.synology.urlRequired">NAS URL is required</mat-error>
      } @else if (group().controls.url.hasError('pattern')) {
        <mat-error i18n="@@connectors.synology.urlInvalid">
          Enter an http or https URL, e.g. https://nas.example.com:5001
        </mat-error>
      }
    </mat-form-field>

    <mat-form-field>
      <mat-label i18n="@@connectors.synology.account">Account</mat-label>
      <input matInput [formControl]="group().controls.account" autocomplete="off" required />
      @if (group().controls.account.hasError('required')) {
        <mat-error i18n="@@connectors.synology.accountRequired">Account is required</mat-error>
      }
    </mat-form-field>

    <mat-form-field>
      <mat-label i18n="@@connectors.synology.password">Password</mat-label>
      <input
        matInput
        type="password"
        [formControl]="group().controls.password"
        autocomplete="new-password"
        [required]="!passwordSet()"
      />
      @if (passwordSet()) {
        <mat-hint i18n="@@connectors.synology.passwordStored">
          The password is stored. Leave empty to keep it.
        </mat-hint>
      }
      @if (group().controls.password.hasError('required')) {
        <mat-error i18n="@@connectors.synology.passwordRequired">Password is required</mat-error>
      }
    </mat-form-field>

    <mat-checkbox
      [formControl]="group().controls.skipTlsVerify"
      i18n="@@connectors.synology.skipTlsVerify"
    >
      Skip TLS certificate verification
    </mat-checkbox>
    @if (group().controls.skipTlsVerify.value) {
      <p class="form-warning" role="alert" i18n="@@connectors.synology.skipTlsVerifyWarning">
        The certificate of the NAS is not checked, so the connection is not protected against
        attackers in the network. Use this only for a self-signed certificate in a trusted network.
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .form-note {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }

    .form-warning {
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class SynologyConfigForm {
  readonly group = input.required<SynologyConfigGroup>();
  /** True when editing a connector that already has a stored password. */
  readonly passwordSet = input(false);
}
