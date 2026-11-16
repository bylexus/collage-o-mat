package photo

import (
	"context"
	"encoding/json"

	"collageomat/internal/apperr"
	"collageomat/internal/connector"
)

// Connectors loads connectors of a user (implemented by
// *connector.Service).
type Connectors interface {
	// LoadConfig returns apperr.ErrNotFound if the connector does not exist
	// or belongs to another user.
	LoadConfig(ctx context.Context, userID, id uint) (connector.Connector, json.RawMessage, error)
}

// SourcesByType implements Sources for several connector types: it looks up
// the type of the connector and delegates to the Sources of that type
// (e.g. immich.Service, synology.Service).
type SourcesByType struct {
	connectors Connectors
	byType     map[string]Sources
}

var _ Sources = (*SourcesByType)(nil)

// NewSourcesByType returns a Sources that delegates by connector type.
// byType maps a connector type name (connector.Kind.Type) to its Sources.
func NewSourcesByType(connectors Connectors, byType map[string]Sources) *SourcesByType {
	return &SourcesByType{connectors: connectors, byType: byType}
}

// Source implements Sources. A connector type without Sources gives an
// apperr validation error.
func (s *SourcesByType) Source(ctx context.Context, userID, connectorID uint) (Source, error) {
	c, _, err := s.connectors.LoadConfig(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	sources, ok := s.byType[c.Type]
	if !ok {
		return nil, apperr.Validation("photos cannot be imported from connectors of type %q", c.Type)
	}
	return sources.Source(ctx, userID, connectorID)
}
