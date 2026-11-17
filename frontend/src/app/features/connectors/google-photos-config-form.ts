import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject, input } from '@angular/core';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GooglePhotosPublicConfig } from '../../core/models/connector';
import { NotificationService } from '../../shared/notification.service';

/** Path of the OAuth redirect URI (same as `googlephotos.CallbackPath` in the backend). */
const CALLBACK_PATH = '/api/googlephotos/oauth/callback';

/** Form group of the Google Photos config; its value is a `GooglePhotosConfigInput`. */
export type GooglePhotosConfigGroup = FormGroup<{
  clientId: FormControl<string>;
  clientSecret: FormControl<string>;
  redirectUri: FormControl<string>;
}>;

/** OAuth redirect URI of this Collage-o-mat server, as seen by the browser. */
export function googlePhotosRedirectUri(): string {
  return window.location.origin + CALLBACK_PATH;
}

/**
 * Creates the Google Photos config form group. With `current` (edit), the client ID is prefilled
 * and the client secret is optional if one is stored (empty = keep the stored secret). The
 * redirect URI is always the one of the current origin (not editable).
 */
export function createGooglePhotosConfigGroup(
  fb: NonNullableFormBuilder,
  current?: GooglePhotosPublicConfig,
): GooglePhotosConfigGroup {
  return fb.group({
    clientId: [current?.clientId ?? '', [Validators.required]],
    clientSecret: ['', current?.clientSecretSet ? [] : [Validators.required]],
    redirectUri: [googlePhotosRedirectUri()],
  });
}

/** Type-specific fields of a Google Photos connector (presentational; the parent owns the group). */
@Component({
  selector: 'app-google-photos-config-form',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  template: `
    <p class="form-note" i18n="@@connectors.googlePhotos.note">
      Uses the OAuth client of your own Google Cloud project with the Google Photos Picker API.
    </p>

    <mat-form-field>
      <mat-label i18n="@@connectors.googlePhotos.clientId">Client ID</mat-label>
      <input matInput [formControl]="group().controls.clientId" autocomplete="off" required />
      @if (group().controls.clientId.hasError('required')) {
        <mat-error i18n="@@connectors.googlePhotos.clientIdRequired">
          Client ID is required
        </mat-error>
      }
    </mat-form-field>

    <mat-form-field>
      <mat-label i18n="@@connectors.googlePhotos.clientSecret">Client secret</mat-label>
      <input
        matInput
        type="password"
        [formControl]="group().controls.clientSecret"
        autocomplete="new-password"
        [required]="!clientSecretSet()"
      />
      @if (clientSecretSet()) {
        <mat-hint i18n="@@connectors.googlePhotos.clientSecretStored">
          The client secret is stored. Leave empty to keep it.
        </mat-hint>
      }
      @if (group().controls.clientSecret.hasError('required')) {
        <mat-error i18n="@@connectors.googlePhotos.clientSecretRequired">
          Client secret is required
        </mat-error>
      }
    </mat-form-field>

    <mat-form-field>
      <mat-label i18n="@@connectors.googlePhotos.redirectUri">Redirect URI</mat-label>
      <input matInput [value]="group().controls.redirectUri.value" readonly />
      <button
        matIconButton
        matSuffix
        type="button"
        [matTooltip]="copyLabel"
        [attr.aria-label]="copyLabel"
        (click)="copyRedirectUri()"
      >
        <mat-icon>content_copy</mat-icon>
      </button>
    </mat-form-field>
    <p class="form-note" i18n="@@connectors.googlePhotos.redirectUriHint">
      Register this redirect URI in your Google Cloud OAuth client. See the README section 'Connect
      Google Photos'.
    </p>
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
  `,
})
export class GooglePhotosConfigForm {
  private readonly clipboard = inject(Clipboard);
  private readonly notification = inject(NotificationService);

  readonly group = input.required<GooglePhotosConfigGroup>();
  /** True when editing a connector that already has a stored client secret. */
  readonly clientSecretSet = input(false);

  protected readonly copyLabel = $localize`:@@connectors.googlePhotos.copyRedirectUri:Copy redirect URI`;

  protected copyRedirectUri(): void {
    if (this.clipboard.copy(this.group().controls.redirectUri.value)) {
      this.notification.success(
        $localize`:@@connectors.googlePhotos.redirectUriCopied:Redirect URI copied`,
      );
    } else {
      this.notification.error(
        $localize`:@@connectors.googlePhotos.redirectUriCopyFailed:Could not copy the redirect URI`,
      );
    }
  }
}
