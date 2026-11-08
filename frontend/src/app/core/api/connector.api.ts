import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ConnectorSummary,
  ConnectorTestResult,
  CreateConnectorRequest,
  UpdateConnectorRequest,
} from '../models/connector';

/** HTTP calls of `/api/connectors`. Holds no state. */
@Injectable({ providedIn: 'root' })
export class ConnectorApi {
  private readonly http = inject(HttpClient);

  /** Connectors of the current user, ordered by name. */
  list(): Observable<ConnectorSummary[]> {
    return this.http.get<ConnectorSummary[]>('/api/connectors');
  }

  create(request: CreateConnectorRequest): Observable<ConnectorSummary> {
    return this.http.post<ConnectorSummary>('/api/connectors', request);
  }

  update(id: number, request: UpdateConnectorRequest): Observable<ConnectorSummary> {
    return this.http.put<ConnectorSummary>(`/api/connectors/${id}`, request);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`/api/connectors/${id}`);
  }

  /** Tests the connection with the stored config. */
  test(id: number): Observable<ConnectorTestResult> {
    return this.http.post<ConnectorTestResult>(`/api/connectors/${id}/test`, {});
  }
}
