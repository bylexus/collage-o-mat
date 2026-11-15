// Package settings contains the system-wide settings of the admin section.
// Each setting is one row of the table system_settings (key + JSON value);
// the typed Settings struct maps the rows (see Settings).
package settings

import (
	"time"

	"collageomat/internal/jsoncol"
)

// SystemSetting is one system-wide setting. Key is the JSON name of the
// Settings field; Value is its JSON value.
type SystemSetting struct {
	Key       string       `gorm:"primaryKey;size:64"`
	Value     jsoncol.JSON `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// TableName sets the table name.
func (SystemSetting) TableName() string { return "system_settings" }
