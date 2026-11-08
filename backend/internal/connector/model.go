// Package connector manages the external photo sources of a user
// (connectors). The type-specific parts (config format, connection test) are
// implemented by a Kind per connector type, registered in a Registry.
package connector

import (
	"time"

	"collageomat/internal/auth"
)

// Connector is a configured photo source of one user.
type Connector struct {
	ID     uint      `gorm:"primaryKey"`
	UserID uint      `gorm:"not null;index"`
	User   auth.User `gorm:"constraint:OnDelete:CASCADE"`
	Type   string    `gorm:"size:32;not null"`
	Name   string    `gorm:"size:100;not null"`
	// Config is the type-specific JSON config, encrypted as a whole
	// (base64 of AES-GCM nonce ‖ ciphertext). It contains secrets such as
	// API keys and is never returned by the API.
	Config    string `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// TableName sets the table name.
func (Connector) TableName() string { return "connectors" }
