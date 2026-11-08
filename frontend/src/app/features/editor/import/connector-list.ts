import { Component, input, output } from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { ConnectorSummary } from '../../../core/models/connector';

/** Step "choose connector" of the import dialog (presentational). */
@Component({
  selector: 'app-connector-list',
  imports: [MatListModule],
  template: `
    <mat-action-list>
      @for (connector of connectors(); track connector.id) {
        <button mat-list-item type="button" (click)="selected.emit(connector)">
          <span matListItemTitle>{{ connector.name }}</span>
          <span matListItemLine>{{ connector.config.url }}</span>
        </button>
      }
    </mat-action-list>
  `,
})
export class ConnectorList {
  readonly connectors = input.required<readonly ConnectorSummary[]>();
  readonly selected = output<ConnectorSummary>();
}
