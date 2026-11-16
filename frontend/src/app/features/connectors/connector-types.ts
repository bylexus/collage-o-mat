import { ConnectorType } from '../../core/models/connector';

/** All connector types, in the order shown in the "Add connector" menu. */
export const CONNECTOR_TYPES: readonly ConnectorType[] = ['immich', 'synology'];

/** Display name of a connector type. */
export function connectorTypeLabel(type: ConnectorType): string {
  switch (type) {
    case 'immich':
      return $localize`:@@connectors.type.immich:Immich`;
    case 'synology':
      return $localize`:@@connectors.type.synology:Synology`;
  }
}
