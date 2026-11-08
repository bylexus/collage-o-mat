// Package collage contains the Collage model and the collage CRUD API
// (list, create, get, rename, delete, save layout).
package collage

import (
	"time"

	"collageomat/internal/auth"
	"collageomat/internal/jsoncol"
)

// Collage is one page of a user with photos and texts. The layout settings
// (page size, background, border, arrangement mode, ...) are one JSON
// document owned by the frontend; the backend only checks that it is a JSON
// object.
type Collage struct {
	ID        uint         `gorm:"primaryKey"`
	UserID    uint         `gorm:"not null;index"`
	User      auth.User    `gorm:"constraint:OnDelete:CASCADE"`
	Name      string       `gorm:"size:200;not null"`
	Settings  jsoncol.JSON `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// TableName sets the table name.
func (Collage) TableName() string { return "collages" }
