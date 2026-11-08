package connector

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"collageomat/internal/apperr"
)

// GormStore is the database repository for connectors. It is the only part
// of the package that uses GORM. All reads and writes are limited to the
// rows of the given user: a connector of another user is handled like a
// missing one (apperr.ErrNotFound).
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// ListByUser returns the connectors of a user, ordered by name.
func (s *GormStore) ListByUser(ctx context.Context, userID uint) ([]Connector, error) {
	var list []Connector
	err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("name ASC, id ASC").
		Find(&list).Error
	if err != nil {
		return nil, fmt.Errorf("list connectors of user %d: %w", userID, err)
	}
	return list, nil
}

// Get returns the connector id of a user.
func (s *GormStore) Get(ctx context.Context, userID, id uint) (Connector, error) {
	var c Connector
	err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).Take(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Connector{}, apperr.ErrNotFound
	}
	if err != nil {
		return Connector{}, fmt.Errorf("load connector %d: %w", id, err)
	}
	return c, nil
}

// Create inserts c and sets its ID and timestamps.
func (s *GormStore) Create(ctx context.Context, c *Connector) error {
	if err := s.db.WithContext(ctx).Create(c).Error; err != nil {
		return fmt.Errorf("create connector: %w", err)
	}
	return nil
}

// Update saves the name and config of c (identified by c.ID and c.UserID)
// and sets c.UpdatedAt.
func (s *GormStore) Update(ctx context.Context, c *Connector) error {
	res := s.db.WithContext(ctx).Model(c).
		Where("user_id = ?", c.UserID).
		Select("Name", "Config").
		Updates(c)
	if res.Error != nil {
		return fmt.Errorf("update connector %d: %w", c.ID, res.Error)
	}
	if res.RowsAffected == 0 {
		return apperr.ErrNotFound
	}
	return nil
}

// Delete removes the connector id of a user.
func (s *GormStore) Delete(ctx context.Context, userID, id uint) error {
	res := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).Delete(&Connector{})
	if res.Error != nil {
		return fmt.Errorf("delete connector %d: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		return apperr.ErrNotFound
	}
	return nil
}
