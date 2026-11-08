package connector

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"collageomat/internal/apperr"
)

// maxNameLength is the maximum length of a connector name in characters.
const maxNameLength = 100

// Cipher encrypts the connector configs for storage (implemented by
// secretbox.Box).
type Cipher interface {
	Encrypt(plaintext []byte) (string, error)
	Decrypt(encoded string) ([]byte, error)
}

// Store is the persistence the Service needs (implemented by GormStore).
type Store interface {
	ListByUser(ctx context.Context, userID uint) ([]Connector, error)
	Get(ctx context.Context, userID, id uint) (Connector, error)
	Create(ctx context.Context, c *Connector) error
	Update(ctx context.Context, c *Connector) error
	Delete(ctx context.Context, userID, id uint) error
}

// Summary is a connector as shown to its owner. Config is the public config
// of the Kind (no secrets).
type Summary struct {
	ID     uint            `json:"id"`
	Type   string          `json:"type"`
	Name   string          `json:"name"`
	Config json.RawMessage `json:"config"`
}

// CreateInput is the data for a new connector.
type CreateInput struct {
	Type   string
	Name   string
	Config json.RawMessage
}

// UpdateInput is the data for changing a connector. The type cannot change.
type UpdateInput struct {
	Name   string
	Config json.RawMessage
}

// Service contains the connector business rules. Every method takes the ID
// of the logged-in user; connectors of other users are reported as
// apperr.ErrNotFound.
type Service struct {
	store  Store
	cipher Cipher
	kinds  *Registry
}

// NewService returns a connector service.
func NewService(store Store, cipher Cipher, kinds *Registry) *Service {
	return &Service{store: store, cipher: cipher, kinds: kinds}
}

// List returns the connectors of a user.
func (s *Service) List(ctx context.Context, userID uint) ([]Summary, error) {
	list, err := s.store.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Summary, 0, len(list))
	for i := range list {
		sum, err := s.summary(&list[i])
		if err != nil {
			return nil, err
		}
		out = append(out, sum)
	}
	return out, nil
}

// Create validates and stores a new connector.
func (s *Service) Create(ctx context.Context, userID uint, in CreateInput) (Summary, error) {
	kind, ok := s.kinds.Lookup(in.Type)
	if !ok {
		return Summary{}, apperr.Validation("unknown connector type %q (known: %s)",
			in.Type, strings.Join(s.kinds.Types(), ", "))
	}
	name, err := normalizeName(in.Name)
	if err != nil {
		return Summary{}, err
	}
	config, err := kind.BuildConfig(in.Config, nil)
	if err != nil {
		return Summary{}, err
	}
	c := Connector{UserID: userID, Type: kind.Type(), Name: name}
	if err := s.encryptInto(&c, config); err != nil {
		return Summary{}, err
	}
	if err := s.store.Create(ctx, &c); err != nil {
		return Summary{}, err
	}
	return s.summaryOf(kind, &c, config)
}

// Update changes the name and config of a connector.
func (s *Service) Update(ctx context.Context, userID, id uint, in UpdateInput) (Summary, error) {
	name, err := normalizeName(in.Name)
	if err != nil {
		return Summary{}, err
	}
	c, kind, stored, err := s.load(ctx, userID, id)
	if err != nil {
		return Summary{}, err
	}
	config, err := kind.BuildConfig(in.Config, stored)
	if err != nil {
		return Summary{}, err
	}
	c.Name = name
	if err := s.encryptInto(&c, config); err != nil {
		return Summary{}, err
	}
	if err := s.store.Update(ctx, &c); err != nil {
		return Summary{}, err
	}
	return s.summaryOf(kind, &c, config)
}

// Delete removes a connector.
func (s *Service) Delete(ctx context.Context, userID, id uint) error {
	return s.store.Delete(ctx, userID, id)
}

// Test runs the connection test of a connector with its stored config.
func (s *Service) Test(ctx context.Context, userID, id uint) (TestResult, error) {
	_, kind, stored, err := s.load(ctx, userID, id)
	if err != nil {
		return TestResult{}, err
	}
	return kind.Test(ctx, stored)
}

// LoadConfig returns a connector of the user together with its decrypted
// config (the full config including secrets, as built by the Kind's
// BuildConfig). It is meant for type-specific code that talks to the source,
// e.g. the Immich routes: they check Connector.Type and parse the config
// with their own Kind. The config must never be sent to the client.
func (s *Service) LoadConfig(ctx context.Context, userID, id uint) (Connector, json.RawMessage, error) {
	c, _, stored, err := s.load(ctx, userID, id)
	if err != nil {
		return Connector{}, nil, err
	}
	return c, stored, nil
}

// load returns an owned connector, its Kind and its decrypted config.
func (s *Service) load(ctx context.Context, userID, id uint) (Connector, Kind, json.RawMessage, error) {
	c, err := s.store.Get(ctx, userID, id)
	if err != nil {
		return Connector{}, nil, nil, err
	}
	kind, config, err := s.open(&c)
	if err != nil {
		return Connector{}, nil, nil, err
	}
	return c, kind, config, nil
}

// open returns the Kind and the decrypted config of a stored connector. An
// unknown stored type is an internal error (the type was removed from the
// registry).
func (s *Service) open(c *Connector) (Kind, json.RawMessage, error) {
	kind, ok := s.kinds.Lookup(c.Type)
	if !ok {
		return nil, nil, fmt.Errorf("connector %d has unknown type %q", c.ID, c.Type)
	}
	plain, err := s.cipher.Decrypt(c.Config)
	if err != nil {
		return nil, nil, fmt.Errorf("decrypt config of connector %d: %w", c.ID, err)
	}
	return kind, plain, nil
}

// summary returns the public view of a stored connector.
func (s *Service) summary(c *Connector) (Summary, error) {
	kind, config, err := s.open(c)
	if err != nil {
		return Summary{}, err
	}
	return s.summaryOf(kind, c, config)
}

// summaryOf returns the public view of c with the decrypted config.
func (s *Service) summaryOf(kind Kind, c *Connector, config json.RawMessage) (Summary, error) {
	public, err := kind.PublicConfig(config)
	if err != nil {
		return Summary{}, fmt.Errorf("public config of connector %d: %w", c.ID, err)
	}
	return Summary{ID: c.ID, Type: c.Type, Name: c.Name, Config: public}, nil
}

// encryptInto encrypts config and stores it in c.Config.
func (s *Service) encryptInto(c *Connector, config json.RawMessage) error {
	enc, err := s.cipher.Encrypt(config)
	if err != nil {
		return fmt.Errorf("encrypt connector config: %w", err)
	}
	c.Config = enc
	return nil
}

// normalizeName trims the name and checks its length.
func normalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", apperr.Validation("name is required")
	}
	if utf8.RuneCountInString(name) > maxNameLength {
		return "", apperr.Validation("name must be at most %d characters", maxNameLength)
	}
	return name, nil
}
