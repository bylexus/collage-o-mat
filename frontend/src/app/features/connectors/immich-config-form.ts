import { Component, input } from '@angular/core';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ImmichPublicConfig } from '../../core/models/connector';

/** Form group of the Immich config; its value is an `ImmichConfigInput`. */
export type ImmichConfigGroup = FormGroup<{
  url: FormControl<string>;
  apiKey: FormControl<string>;
}>;

/** Rough client-side check; the backend validates the URL fully. */
const HTTP_URL_PATTERN = /^https?:\/\/[^\s/?#]+\S*$/i;

/**
 * Creates the Immich config form group. With `current` (edit), the URL is prefilled and the API
 * key is optional if one is stored (empty = keep the stored key).
 */
export function createImmichConfigGroup(
  fb: NonNullableFormBuilder,
  current?: ImmichPublicConfig,
): ImmichConfigGroup {
  return fb.group({
    url: [current?.url ?? '', [Validators.required, Validators.pattern(HTTP_URL_PATTERN)]],
    apiKey: ['', current?.apiKeySet ? [] : [Validators.required]],
  });
}

/** Type-specific fields of an Immich connector (presentational; the parent owns the group). */
@Component({
  selector: 'app-immich-config-form',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule],
  template: `
    <mat-form-field>
      <mat-label i18n="@@connectors.immich.url">Server URL</mat-label>
      <input
        matInput
        type="url"
        [formControl]="group().controls.url"
        placeholder="https://immich.example.com"
        autocomplete="url"
        required
      />
      @if (group().controls.url.hasError('required')) {
        <mat-error i18n="@@connectors.immich.urlRequired">Server URL is required</mat-error>
      } @else if (group().controls.url.hasError('pattern')) {
        <mat-error i18n="@@connectors.immich.urlInvalid">
          Enter an http or https URL, e.g. https://immich.example.com
        </mat-error>
      }
    </mat-form-field>

    <mat-form-field>
      <mat-label i18n="@@connectors.immich.apiKey">API key</mat-label>
      <input
        matInput
        type="password"
        [formControl]="group().controls.apiKey"
        autocomplete="new-password"
        [required]="!apiKeySet()"
      />
      @if (apiKeySet()) {
        <mat-hint i18n="@@connectors.immich.apiKeyStored">
          The key is stored. Leave empty to keep it.
        </mat-hint>
      } @else {
        <mat-hint i18n="@@connectors.immich.apiKeyPermissions">
          Needs the permissions album.read, asset.read and asset.view.
        </mat-hint>
      }
      @if (group().controls.apiKey.hasError('required')) {
        <mat-error i18n="@@connectors.immich.apiKeyRequired">API key is required</mat-error>
      }
    </mat-form-field>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  `,
})
export class ImmichConfigForm {
  readonly group = input.required<ImmichConfigGroup>();
  /** True when editing a connector that already has a stored API key. */
  readonly apiKeySet = input(false);
}
