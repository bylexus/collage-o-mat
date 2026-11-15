package admin

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"collageomat/internal/apperr"
	"collageomat/internal/auth"
	"collageomat/internal/db"
)

// GormStore is the database repository for the user management. It works on
// the users and sessions tables of the auth package. It is the only part of
// the package that uses GORM. All methods join the transaction of ctx, if
// any (see db.Transactor).
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// ListUsers returns all users, ordered by username.
func (s *GormStore) ListUsers(ctx context.Context) ([]auth.User, error) {
	var users []auth.User
	if err := db.Conn(ctx, s.db).Order("username ASC, id ASC").Find(&users).Error; err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	return users, nil
}

// FindUser returns the user with the given id, or apperr.ErrNotFound.
func (s *GormStore) FindUser(ctx context.Context, id uint) (*auth.User, error) {
	var u auth.User
	err := db.Conn(ctx, s.db).Where("id = ?", id).Take(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load user %d: %w", id, err)
	}
	return &u, nil
}

// UsernameExists reports whether a user with the username exists.
func (s *GormStore) UsernameExists(ctx context.Context, username string) (bool, error) {
	var count int64
	err := db.Conn(ctx, s.db).Model(&auth.User{}).Where("username = ?", username).Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check username: %w", err)
	}
	return count > 0, nil
}

// CreateUser inserts u and sets its ID and timestamps. The caller sets
// u.IsActive (GORM skips a false value because of the column default).
func (s *GormStore) CreateUser(ctx context.Context, u *auth.User) error {
	if err := db.Conn(ctx, s.db).Create(u).Error; err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

// UpdateUser sets the admin and active flags (and UpdatedAt) of the user
// id. A non-empty passwordHash also replaces the password hash. A map
// update is used, so that false values are written.
func (s *GormStore) UpdateUser(ctx context.Context, id uint, isAdmin, isActive bool, passwordHash string) error {
	fields := map[string]any{"is_admin": isAdmin, "is_active": isActive}
	if passwordHash != "" {
		fields["password_hash"] = passwordHash
	}
	res := db.Conn(ctx, s.db).Model(&auth.User{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return fmt.Errorf("update user %d: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		return apperr.ErrNotFound
	}
	return nil
}

// DeleteSessions deletes all sessions of the user.
func (s *GormStore) DeleteSessions(ctx context.Context, userID uint) error {
	if err := db.Conn(ctx, s.db).Where("user_id = ?", userID).Delete(&auth.Session{}).Error; err != nil {
		return fmt.Errorf("delete sessions of user %d: %w", userID, err)
	}
	return nil
}

// DeleteUser deletes the users row; the foreign keys ON DELETE CASCADE
// remove the rows of the other tables. It returns apperr.ErrNotFound if
// the user does not exist.
func (s *GormStore) DeleteUser(ctx context.Context, id uint) error {
	res := db.Conn(ctx, s.db).Delete(&auth.User{}, id)
	if res.Error != nil {
		return fmt.Errorf("delete user %d: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		return apperr.ErrNotFound
	}
	return nil
}

// CountActiveAdmins returns the number of users that are admin and active.
func (s *GormStore) CountActiveAdmins(ctx context.Context) (int64, error) {
	var count int64
	err := db.Conn(ctx, s.db).Model(&auth.User{}).
		Where("is_admin = ? AND is_active = ?", true, true).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count active admins: %w", err)
	}
	return count, nil
}
