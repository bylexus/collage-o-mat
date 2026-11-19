package quota

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"collageomat/internal/apperr"
	"collageomat/internal/auth"
	"collageomat/internal/db"
)

// GormStore reads the own storage limit of users. It is the only part of
// the package that uses GORM. All methods join the transaction of ctx, if
// any (see db.Transactor).
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// MaxStorageBytes returns users.max_storage_bytes of the user (nil = server
// default), or apperr.ErrNotFound for an unknown user.
func (s *GormStore) MaxStorageBytes(ctx context.Context, userID uint) (*int64, error) {
	var u auth.User
	err := db.Conn(ctx, s.db).Select("id, max_storage_bytes").Where("id = ?", userID).Take(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load storage limit of user %d: %w", userID, err)
	}
	return u.MaxStorageBytes, nil
}
