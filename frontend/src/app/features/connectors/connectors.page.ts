import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ConnectorApi } from '../../core/api/connector.api';
import { ConnectorSummary, ConnectorTestResult, ConnectorType } from '../../core/models/connector';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../shared/error-message';
import { NotificationService } from '../../shared/notification.service';
import { ConnectorDialog, ConnectorDialogData, ConnectorDialogValue } from './connector-dialog';
import { CONNECTOR_TYPES, connectorTypeLabel } from './connector-types';

/** State of the connection test of one connector. */
type TestState = { running: true } | { running: false; result: ConnectorTestResult };

/** Settings page: list, add, edit, delete and test the connectors of the user. */
@Component({
  selector: 'app-connectors-page',
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule],
  templateUrl: './connectors.page.html',
  styleUrl: './connectors.page.scss',
})
export class ConnectorsPage {
  private readonly api = inject(ConnectorApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirmService = inject(ConfirmService);
  private readonly notification = inject(NotificationService);

  protected readonly connectors = signal<ConnectorSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly tests = signal<ReadonlyMap<number, TestState>>(new Map());
  protected readonly typeLabel = connectorTypeLabel;
  protected readonly connectorTypes = CONNECTOR_TYPES;

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.connectors.set(await firstValueFrom(this.api.list()));
    } catch (err) {
      this.loadError.set(
        errorMessage(err, $localize`:@@connectors.loadError:Could not load the connectors.`),
      );
    } finally {
      this.loading.set(false);
    }
  }

  /** Short detail of a connector for its card: the server URL, or the OAuth client ID. */
  protected connectorDetail(connector: ConnectorSummary): string {
    switch (connector.type) {
      case 'immich':
      case 'synology':
        return connector.config.url;
      case 'googlephotos':
        return connector.config.clientId;
    }
  }

  protected add(type: ConnectorType): void {
    this.openDialog(null, type, (value) => firstValueFrom(this.api.create(value)));
  }

  protected edit(connector: ConnectorSummary): void {
    this.openDialog(connector, connector.type, ({ name, config }) =>
      firstValueFrom(this.api.update(connector.id, { name, config })),
    );
  }

  protected async remove(connector: ConnectorSummary): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: $localize`:@@connectors.delete.title:Delete connector?`,
      message: $localize`:@@connectors.delete.message:The connector "${connector.name}:name:" will be deleted. Photos already imported stay in their collages.`,
      confirmLabel: $localize`:@@connectors.delete.confirm:Delete`,
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await firstValueFrom(this.api.delete(connector.id));
      this.notification.success($localize`:@@connectors.delete.done:Connector deleted`);
      this.setTest(connector.id, null);
      await this.load();
    } catch (err) {
      this.notification.error(errorMessage(err));
    }
  }

  protected async test(connector: ConnectorSummary): Promise<void> {
    this.setTest(connector.id, { running: true });
    let result: ConnectorTestResult;
    try {
      result = await firstValueFrom(this.api.test(connector.id));
    } catch (err) {
      result = { ok: false, error: errorMessage(err) };
    }
    this.setTest(connector.id, { running: false, result });
  }

  private openDialog(
    connector: ConnectorSummary | null,
    type: ConnectorType,
    persist: (value: ConnectorDialogValue) => Promise<unknown>,
  ): void {
    const data: ConnectorDialogData = { connector, type, save: persist };
    const ref = this.dialog.open<ConnectorDialog, ConnectorDialogData, boolean>(ConnectorDialog, {
      data,
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    });
    ref.afterClosed().subscribe((saved) => {
      if (!saved) {
        return;
      }
      this.notification.success($localize`:@@connectors.saved:Connector saved`);
      if (connector) {
        this.setTest(connector.id, null);
      }
      void this.load();
    });
  }

  private setTest(id: number, state: TestState | null): void {
    this.tests.update((current) => {
      const next = new Map(current);
      if (state) {
        next.set(id, state);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
