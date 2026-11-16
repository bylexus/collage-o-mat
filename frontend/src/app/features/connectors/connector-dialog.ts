import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConnectorConfigInput, ConnectorSummary, ConnectorType } from '../../core/models/connector';
import { errorMessage } from '../../shared/error-message';
import { connectorTypeLabel } from './connector-types';
import { createImmichConfigGroup, ImmichConfigForm, ImmichConfigGroup } from './immich-config-form';
import {
  createSynologyConfigGroup,
  SynologyConfigForm,
  SynologyConfigGroup,
} from './synology-config-form';

/** Maximum length of a connector name (same as the backend). */
const MAX_NAME_LENGTH = 100;

/** Values entered in the connector dialog. */
export interface ConnectorDialogValue {
  type: ConnectorType;
  name: string;
  config: ConnectorConfigInput;
}

/** Input of the connector dialog. */
export interface ConnectorDialogData {
  /** Connector to edit; `null` creates a new connector of `type`. */
  connector: ConnectorSummary | null;
  /** Type of the new connector; ignored on edit (the type cannot change). */
  type: ConnectorType;
  /**
   * Saves the values (done by the page). A rejected promise keeps the dialog open and shows the
   * error; on success the dialog closes with `true`.
   */
  save: (value: ConnectorDialogValue) => Promise<unknown>;
}

/**
 * Create/edit dialog of a connector: common fields (name) plus the form of the connector type.
 * A new type adds its config form component, its group field and one `@case`.
 */
@Component({
  selector: 'app-connector-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ImmichConfigForm,
    SynologyConfigForm,
  ],
  template: `
    <h2 mat-dialog-title>
      @if (isEdit) {
        <ng-container i18n="@@connectors.dialog.editTitle">Edit connector</ng-container>
      } @else {
        <ng-container i18n="@@connectors.dialog.addTitle">Add connector</ng-container>
      }
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="dialog-fields">
        <p class="dialog-type" i18n="@@connectors.dialog.type">Type: {{ typeLabel }}</p>

        <mat-form-field>
          <mat-label i18n="@@connectors.dialog.name">Name</mat-label>
          <input
            matInput
            formControlName="name"
            [maxlength]="maxNameLength"
            required
            cdkFocusInitial
          />
          @if (form.controls.name.hasError('required')) {
            <mat-error i18n="@@connectors.dialog.nameRequired">Name is required</mat-error>
          }
        </mat-form-field>

        @switch (type) {
          @case ('immich') {
            @if (immichConfig; as group) {
              <app-immich-config-form [group]="group" [apiKeySet]="apiKeySet" />
            }
          }
          @case ('synology') {
            @if (synologyConfig; as group) {
              <app-synology-config-form [group]="group" [passwordSet]="passwordSet" />
            }
          }
        }

        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close [disabled]="saving()">
          <ng-container i18n="@@connectors.dialog.cancel">Cancel</ng-container>
        </button>
        <button matButton="filled" type="submit" [disabled]="saving()">
          @if (saving()) {
            <mat-spinner class="dialog-spinner" diameter="18" />
          }
          <ng-container i18n="@@connectors.dialog.save">Save</ng-container>
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .dialog-fields {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .dialog-type {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
    }

    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-medium);
    }

    .dialog-spinner {
      display: inline-block;
      margin-right: 8px;
      vertical-align: middle;
    }
  `,
})
export class ConnectorDialog {
  protected readonly data = inject<ConnectorDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ConnectorDialog, boolean>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);

  private readonly connector = this.data.connector;
  protected readonly isEdit = this.connector !== null;
  protected readonly type: ConnectorType = this.connector?.type ?? this.data.type;
  protected readonly typeLabel = connectorTypeLabel(this.type);
  protected readonly maxNameLength = MAX_NAME_LENGTH;

  /** Config group of the Immich form; `null` for other types. */
  protected readonly immichConfig =
    this.type === 'immich'
      ? createImmichConfigGroup(
          this.fb,
          this.connector?.type === 'immich' ? this.connector.config : undefined,
        )
      : null;
  protected readonly apiKeySet =
    this.connector?.type === 'immich' && this.connector.config.apiKeySet;

  /** Config group of the Synology form; `null` for other types. */
  protected readonly synologyConfig =
    this.type === 'synology'
      ? createSynologyConfigGroup(
          this.fb,
          this.connector?.type === 'synology' ? this.connector.config : undefined,
        )
      : null;
  protected readonly passwordSet =
    this.connector?.type === 'synology' && this.connector.config.passwordSet;

  /** Config group of the dialog's type (exactly one of the groups above is set). */
  private readonly config: ImmichConfigGroup | SynologyConfigGroup = (this.immichConfig ??
    this.synologyConfig)!;

  protected readonly form = this.fb.group({
    name: [this.connector?.name ?? '', Validators.required],
    config: this.config,
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const name = this.form.controls.name.getRawValue();
    const config: ConnectorConfigInput = this.config.getRawValue();
    this.setSaving(true);
    this.error.set(null);
    try {
      await this.data.save({ type: this.type, name: name.trim(), config });
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
    }
  }
}
