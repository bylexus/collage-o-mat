package auth

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// CreateUser creates a new user. It fails if the username exists.
func CreateUser(db *gorm.DB, username, password string, isAdmin bool) (*User, error) {
	username, err := NormalizeUsername(username)
	if err != nil {
		return nil, err
	}
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return nil, err
	}

	user := &User{Username: username, PasswordHash: hash, IsAdmin: isAdmin}
	err = db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&User{}).Where("username = ?", username).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("user %q already exists", username)
		}
		return tx.Create(user).Error
	})
	if err != nil {
		return nil, err
	}
	return user, nil
}

// SetPassword sets a new password for an existing user and deletes all
// sessions of that user.
func SetPassword(db *gorm.DB, username, password string) error {
	username, err := NormalizeUsername(username)
	if err != nil {
		return err
	}
	if err := ValidatePassword(password); err != nil {
		return err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Where("username = ?", username).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("user %q does not exist", username)
			}
			return err
		}
		if err := tx.Model(&user).Update("password_hash", hash).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ?", user.ID).Delete(&Session{}).Error
	})
}
