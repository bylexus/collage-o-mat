// Package auth contains users, sessions, password hashing, the session
// middleware, the login/logout/me handlers, the password change of a
// logged-in user (PasswordChanger) and helpers for the user CLI.
package auth

import "time"

// User is a login account. Users are created with the CLI or the admin API.
type User struct {
	ID           uint   `gorm:"primaryKey"`
	Username     string `gorm:"size:64;uniqueIndex;not null"`
	PasswordHash string `gorm:"not null"`
	IsAdmin      bool   `gorm:"not null;default:false"`
	// IsActive is false for a deactivated user: no login, no valid session.
	// The DB default true keeps the users of existing databases active.
	// GORM skips a false zero value on Create because of the default: set it
	// to true on Create and set false only with Update("is_active", false).
	IsActive bool `gorm:"not null;default:true"`
	// LastActiveAt is the time of the last login or authenticated request
	// (column last_active_at, nullable). RequireAuth updates it at most once
	// per activityInterval. NULL: no activity recorded yet.
	LastActiveAt *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// TableName sets the table name.
func (User) TableName() string { return "users" }

// Session is a server-side login session. Only the SHA-256 hash of the
// cookie token is stored.
type Session struct {
	ID        uint      `gorm:"primaryKey"`
	TokenHash string    `gorm:"size:64;uniqueIndex;not null"` // hex SHA-256 of the raw token
	UserID    uint      `gorm:"not null;index"`
	User      User      `gorm:"constraint:OnDelete:CASCADE"`
	ExpiresAt time.Time `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// TableName sets the table name.
func (Session) TableName() string { return "sessions" }
