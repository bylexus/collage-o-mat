import { ConnectorType } from '../../core/models/connector';

/** Display name of a connector type. */
export function connectorTypeLabel(type: ConnectorType): string {
  switch (type) {
    case 'immich':
      return $localize`:@@connectors.type.immich:Immich`;
  }
}
