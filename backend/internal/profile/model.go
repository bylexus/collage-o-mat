package profile

import (
	"time"

	"collageomat/internal/auth"
)

// Avatar is the profile image of a user: a square JPEG of at most
// MaxAvatarEdge × MaxAvatarEdge pixels. It has an own table (and not a
// column of users) because RequireAuth loads the users row on every API
// request.
type Avatar struct {
	UserID    uint      `gorm:"primaryKey;autoIncrement:false"`
	User      auth.User `gorm:"constraint:OnDelete:CASCADE"`
	Data      []byte    `gorm:"not null"`
	MimeType  string    `gorm:"size:64;not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// TableName sets the table name.
func (Avatar) TableName() string { return "user_avatars" }
