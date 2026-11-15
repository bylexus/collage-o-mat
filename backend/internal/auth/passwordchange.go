package auth

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"collageomat/internal/apperr"
)

const msgWrongCurrentPassword = "current password is wrong"

// PasswordChanger changes the password of a logged-in user (implements
// profile.Passwords). Wrong current passwords count in the same
// LoginLimiter as failed logins.
type PasswordChanger struct {
	db      *gorm.DB
	limiter *LoginLimiter
}

// NewPasswordChanger returns a PasswordChanger. limiter must be the same
// instance that the auth Handler uses.
func NewPasswordChanger(db *gorm.DB, limiter *LoginLimiter) *PasswordChanger {
	return &PasswordChanger{db: db, limiter: limiter}
}

// ChangePassword checks currentPassword of the user, sets newPassword and
// deletes all sessions of the user except sessionID. clientIP is part of
// the limiter key (see LoginKey). Errors:
//   - apperr.TooManyRequests if the key is blocked,
//   - apperr validation error if the current password is wrong (status 400,
//     not 401: the client must not treat it as a lost session) or the new
//     password breaks the rules of ValidatePassword.
func (c *PasswordChanger) ChangePassword(
	ctx context.Context, userID, sessionID uint, clientIP, currentPassword, newPassword string,
) error {
	// Reject oversized input before the limiter, the DB and bcrypt; no
	// limiter entry is stored for it.
	if len(currentPassword) > maxPasswordLen {
		return apperr.Validation(msgWrongCurrentPassword)
	}
	if len(newPassword) > maxPasswordLen {
		return apperr.Validation("%s", ValidatePassword(newPassword).Error())
	}

	db := c.db.WithContext(ctx)
	var user User
	if err := db.First(&user, userID).Error; err != nil {
		return fmt.Errorf("change password: load user: %w", err)
	}

	key := LoginKey(user.Username, clientIP)
	if remaining, blocked := c.limiter.Blocked(key); blocked {
		return apperr.TooManyRequests("%s", blockedLoginMessage(remaining))
	}
	if !checkPassword(user.PasswordHash, currentPassword) {
		c.limiter.Fail(key)
		return apperr.Validation(msgWrongCurrentPassword)
	}
	c.limiter.Reset(key)

	if err := ValidatePassword(newPassword); err != nil {
		return apperr.Validation("%s", err.Error())
	}
	hash, err := hashPassword(newPassword)
	if err != nil {
		return err
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&user).Update("password_hash", hash).Error; err != nil {
			return fmt.Errorf("change password: update hash: %w", err)
		}
		if err := tx.Where("user_id = ? AND id <> ?", user.ID, sessionID).Delete(&Session{}).Error; err != nil {
			return fmt.Errorf("change password: delete other sessions: %w", err)
		}
		return nil
	})
}
