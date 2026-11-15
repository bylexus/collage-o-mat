package settings

import (
	"context"
	"encoding/json"
	"fmt"

	"collageomat/internal/apperr"
	"collageomat/internal/jsoncol"
)

// Settings are the system-wide settings. Each field is one row of
// system_settings; its key is the JSON name of the field. A missing row
// gives the default of Defaults.
//
// A new setting needs: a field with a JSON name here, its default in
// Defaults and its rules in validate. No DB migration is needed.
type Settings struct {
	// MaxUserStorageBytes is the photo storage limit per user in bytes;
	// 0 = unlimited. It is not enforced yet.
	MaxUserStorageBytes int64 `json:"maxUserStorageBytes"`
}

// Defaults returns the settings that apply when no value is stored.
func Defaults() Settings {
	return Settings{
		MaxUserStorageBytes: 2_000_000_000,
	}
}

// validate checks the rules of all settings.
func (s Settings) validate() error {
	if s.MaxUserStorageBytes < 0 {
		return apperr.Validation("maxUserStorageBytes must be 0 (unlimited) or more")
	}
	return nil
}

// Store is the persistence the service needs (implemented by GormStore).
type Store interface {
	List(ctx context.Context) ([]SystemSetting, error)
	// UpsertAll saves all rows in one transaction.
	UpsertAll(ctx context.Context, rows []SystemSetting) error
}

// Service reads and changes the system settings.
type Service struct {
	store Store
}

// NewService returns the settings service.
func NewService(store Store) *Service {
	return &Service{store: store}
}

// Get returns the settings: the stored values, defaults for missing keys.
// Stored keys without a Settings field are ignored.
func (s *Service) Get(ctx context.Context) (Settings, error) {
	rows, err := s.store.List(ctx)
	if err != nil {
		return Settings{}, err
	}
	doc := make(map[string]json.RawMessage, len(rows))
	for _, r := range rows {
		if !r.Value.IsNull() {
			doc[r.Key] = json.RawMessage(r.Value)
		}
	}
	b, err := json.Marshal(doc)
	if err != nil {
		return Settings{}, fmt.Errorf("read system settings: %w", err)
	}
	out := Defaults()
	if err := json.Unmarshal(b, &out); err != nil {
		return Settings{}, fmt.Errorf("read system settings: %w", err)
	}
	return out, nil
}

// Update validates the settings, stores all of them (one row per field, in
// one transaction) and returns the stored settings.
func (s *Service) Update(ctx context.Context, in Settings) (Settings, error) {
	if err := in.validate(); err != nil {
		return Settings{}, err
	}
	b, err := json.Marshal(in)
	if err != nil {
		return Settings{}, fmt.Errorf("write system settings: %w", err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(b, &doc); err != nil {
		return Settings{}, fmt.Errorf("write system settings: %w", err)
	}
	rows := make([]SystemSetting, 0, len(doc))
	for key, value := range doc {
		rows = append(rows, SystemSetting{Key: key, Value: jsoncol.JSON(value)})
	}
	if err := s.store.UpsertAll(ctx, rows); err != nil {
		return Settings{}, err
	}
	return s.Get(ctx)
}
