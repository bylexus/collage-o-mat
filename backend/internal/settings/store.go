package settings

import (
	"context"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"collageomat/internal/db"
)

// GormStore is the database repository for the system settings. It is the
// only part of the package that uses GORM. All methods join the transaction
// of ctx, if any (see db.Transactor).
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// List returns all stored settings.
func (s *GormStore) List(ctx context.Context) ([]SystemSetting, error) {
	var rows []SystemSetting
	if err := db.Conn(ctx, s.db).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list system settings: %w", err)
	}
	return rows, nil
}

// UpsertAll inserts the settings or replaces the value and UpdatedAt of the
// existing keys, in one transaction.
func (s *GormStore) UpsertAll(ctx context.Context, rows []SystemSetting) error {
	if len(rows) == 0 {
		return nil
	}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}
	err := db.Conn(ctx, s.db).Transaction(func(tx *gorm.DB) error {
		return tx.Clauses(upsert).Create(&rows).Error
	})
	if err != nil {
		return fmt.Errorf("save system settings: %w", err)
	}
	return nil
}
