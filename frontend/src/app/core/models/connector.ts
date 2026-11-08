/** Connector types known to the frontend (the backend registry has the same names). */
export type ConnectorType = 'immich';

/** Public config of an Immich connector as returned by the API (never contains the API key). */
export interface ImmichPublicConfig {
  url: string;
  apiKeySet: boolean;
}

/** Immich config sent to the API. On update, an empty `apiKey` keeps the stored key. */
export interface ImmichConfigInput {
  url: string;
  apiKey: string;
}

/** Public config of any connector type (a union once more types exist). */
export type ConnectorPublicConfig = ImmichPublicConfig;

/** Config input of any connector type (a union once more types exist). */
export type ConnectorConfigInput = ImmichConfigInput;

/** Connector as returned by `GET /api/connectors`. */
export interface ConnectorSummary {
  id: number;
  type: ConnectorType;
  name: string;
  config: ConnectorPublicConfig;
}

/** Body of `POST /api/connectors`. */
export interface CreateConnectorRequest {
  type: ConnectorType;
  name: string;
  config: ConnectorConfigInput;
}

/** Body of `PUT /api/connectors/{id}` (the type cannot change). */
export interface UpdateConnectorRequest {
  name: string;
  config: ConnectorConfigInput;
}

/** Result of `POST /api/connectors/{id}/test`. A failed test is `ok: false`, not an HTTP error. */
export interface ConnectorTestResult {
  ok: boolean;
  serverVersion?: string;
  error?: string;
}
