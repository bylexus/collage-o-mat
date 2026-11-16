/** Connector types known to the frontend (the backend registry has the same names). */
export type ConnectorType = 'immich' | 'synology';

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

/**
 * Public config of a Synology connector as returned by the API (never contains the password).
 * `url` is the DSM address of the NAS as `scheme://host[:port]`.
 */
export interface SynologyPublicConfig {
  url: string;
  account: string;
  passwordSet: boolean;
  skipTlsVerify: boolean;
}

/**
 * Synology config sent to the API. On update, an empty `password` keeps the stored password. The
 * backend removes any path from `url`.
 */
export interface SynologyConfigInput {
  url: string;
  account: string;
  password: string;
  skipTlsVerify: boolean;
}

/** Public config of any connector type. */
export type ConnectorPublicConfig = ImmichPublicConfig | SynologyPublicConfig;

/** Config input of any connector type. */
export type ConnectorConfigInput = ImmichConfigInput | SynologyConfigInput;

/** Fields of `ConnectorSummary` that are the same for all types. */
interface ConnectorSummaryBase {
  id: number;
  name: string;
}

/** Immich connector as returned by `GET /api/connectors`. */
export interface ImmichConnectorSummary extends ConnectorSummaryBase {
  type: 'immich';
  config: ImmichPublicConfig;
}

/** Synology connector as returned by `GET /api/connectors`. */
export interface SynologyConnectorSummary extends ConnectorSummaryBase {
  type: 'synology';
  config: SynologyPublicConfig;
}

/** Connector as returned by `GET /api/connectors` (discriminated by `type`). */
export type ConnectorSummary = ImmichConnectorSummary | SynologyConnectorSummary;

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
