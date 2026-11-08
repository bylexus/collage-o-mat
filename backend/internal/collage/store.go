package collage

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"collageomat/internal/apperr"
)

// GormStore is the database repository for collages. It is the only part of
// the package that uses GORM.
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// ListByUser returns the collages of a user, most recently updated first.
func (s *GormStore) ListByUser(ctx context.Context, userID uint) ([]Collage, error) {
	var collages []Collage
	err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at DESC, id DESC").
		Find(&collages).Error
	if err != nil {
		return nil, fmt.Errorf("list collages of user %d: %w", userID, err)
	}
	return collages, nil
}

// FindForUser returns the collage with the given id if it belongs to the
// user. Otherwise it returns apperr.ErrNotFound.
func (s *GormStore) FindForUser(ctx context.Context, userID, id uint) (*Collage, error) {
	var c Collage
	err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load collage %d: %w", id, err)
	}
	return &c, nil
}

// Create inserts c and sets its ID and timestamps.
func (s *GormStore) Create(ctx context.Context, c *Collage) error {
	if err := s.db.WithContext(ctx).Omit("User").Create(c).Error; err != nil {
		return fmt.Errorf("create collage: %w", err)
	}
	return nil
}

// UpdateName sets the name of c in the database and in c (also UpdatedAt).
func (s *GormStore) UpdateName(ctx context.Context, c *Collage, name string) error {
	if err := s.db.WithContext(ctx).Model(c).Update("name", name).Error; err != nil {
		return fmt.Errorf("rename collage %d: %w", c.ID, err)
	}
	return nil
}

// Delete deletes the collage row with the given id.
func (s *GormStore) Delete(ctx context.Context, id uint) error {
	if err := s.db.WithContext(ctx).Delete(&Collage{}, id).Error; err != nil {
		return fmt.Errorf("delete collage %d: %w", id, err)
	}
	return nil
}
