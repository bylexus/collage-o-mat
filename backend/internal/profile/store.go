package profile

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"collageomat/internal/apperr"
	"collageomat/internal/db"
)

// GormStore is the database repository for avatars. It is the only part of
// the package that uses GORM. All methods join the transaction of ctx, if
// any (see db.Transactor).
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// FindAvatar returns the avatar of the user, or apperr.ErrNotFound.
func (s *GormStore) FindAvatar(ctx context.Context, userID uint) (*Avatar, error) {
	var a Avatar
	err := db.Conn(ctx, s.db).Where("user_id = ?", userID).Take(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load avatar of user %d: %w", userID, err)
	}
	return &a, nil
}

// AvatarUpdatedAt returns the UpdatedAt of the avatar of the user without
// loading the image data, or apperr.ErrNotFound.
func (s *GormStore) AvatarUpdatedAt(ctx context.Context, userID uint) (time.Time, error) {
	var a Avatar
	err := db.Conn(ctx, s.db).Select("user_id", "updated_at").Where("user_id = ?", userID).Take(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return time.Time{}, apperr.ErrNotFound
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("load avatar version of user %d: %w", userID, err)
	}
	return a.UpdatedAt, nil
}

// UpsertAvatar inserts a or replaces the data, MIME type and UpdatedAt of
// the existing avatar of a.UserID (CreatedAt stays).
func (s *GormStore) UpsertAvatar(ctx context.Context, a *Avatar) error {
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"data", "mime_type", "updated_at"}),
	}
	if err := db.Conn(ctx, s.db).Omit("User").Clauses(upsert).Create(a).Error; err != nil {
		return fmt.Errorf("save avatar of user %d: %w", a.UserID, err)
	}
	return nil
}

// DeleteAvatar deletes the avatar of the user. No avatar is not an error.
func (s *GormStore) DeleteAvatar(ctx context.Context, userID uint) error {
	if err := db.Conn(ctx, s.db).Where("user_id = ?", userID).Delete(&Avatar{}).Error; err != nil {
		return fmt.Errorf("delete avatar of user %d: %w", userID, err)
	}
	return nil
}
