// Package profile contains the profile of the logged-in user: password
// change, avatar and storage usage. The password rules and the brute-force
// limiter live in the auth package; profile reaches them only through the
// Passwords interface. The storage usage comes from the quota package
// through the Storage interface.
package profile

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"collageomat/internal/apperr"
	"collageomat/internal/imaging"
)

// MaxAvatarBytes is the maximum size of an uploaded avatar file.
const MaxAvatarBytes = 10 << 20

// MaxAvatarEdge is the maximum width and height of a stored avatar in
// pixels (smaller images are never upscaled).
const MaxAvatarEdge = 500

// avatarJPEGQuality is the JPEG quality of a stored avatar.
const avatarJPEGQuality = 90

// Passwords is the part of the auth domain that the profile service needs.
// The auth package implements it (auth.PasswordChanger), main.go wires it;
// the service does not depend on the auth implementation (dependency
// inversion).
type Passwords interface {
	// ChangePassword checks currentPassword of the user, sets newPassword
	// and deletes all sessions of the user except sessionID. clientIP is
	// used for the brute-force limiter. It returns apperr.TooManyRequests
	// if the client is blocked and an apperr validation error for a wrong
	// current password or an invalid new password.
	ChangePassword(ctx context.Context, userID, sessionID uint, clientIP, currentPassword, newPassword string) error
}

// Storage gives the photo storage usage of a user. The quota package
// implements it (*quota.Service), main.go wires it.
type Storage interface {
	// Usage returns the used photo bytes and the effective storage limit of
	// the user (0 = unlimited).
	Usage(ctx context.Context, userID uint) (used, limit int64, err error)
}

// Store is the persistence the service needs (implemented by GormStore).
type Store interface {
	// FindAvatar returns apperr.ErrNotFound if the user has no avatar.
	FindAvatar(ctx context.Context, userID uint) (*Avatar, error)
	// AvatarUpdatedAt returns the UpdatedAt of the avatar without its data,
	// or apperr.ErrNotFound if the user has no avatar.
	AvatarUpdatedAt(ctx context.Context, userID uint) (time.Time, error)
	// UpsertAvatar inserts the avatar or replaces data, MIME type and
	// UpdatedAt of the existing one.
	UpsertAvatar(ctx context.Context, a *Avatar) error
	// DeleteAvatar deletes the avatar; no avatar is not an error.
	DeleteAvatar(ctx context.Context, userID uint) error
}

// Service holds the profile use cases.
type Service struct {
	store     Store
	passwords Passwords
	storage   Storage
	// decoder is the server-wide limiter for image decodes (shared with
	// the photo service).
	decoder *imaging.DecodeLimiter
}

// NewService returns the profile service. decoder must be the same limiter
// instance that the other image-decoding services use.
func NewService(store Store, passwords Passwords, storage Storage, decoder *imaging.DecodeLimiter) *Service {
	return &Service{store: store, passwords: passwords, storage: storage, decoder: decoder}
}

// ChangePassword changes the password of the user and keeps only the
// session sessionID (see Passwords.ChangePassword).
func (s *Service) ChangePassword(
	ctx context.Context, userID, sessionID uint, clientIP, currentPassword, newPassword string,
) error {
	return s.passwords.ChangePassword(ctx, userID, sessionID, clientIP, currentPassword, newPassword)
}

// StorageUsage returns the used photo bytes and the effective storage
// limit of the user (0 = unlimited).
func (s *Service) StorageUsage(ctx context.Context, userID uint) (used, limit int64, err error) {
	return s.storage.Usage(ctx, userID)
}

// SetAvatar sets or replaces the avatar of the user. body is an image of
// the given Content-Type (image/jpeg, image/png or image/webp) of at most
// MaxAvatarBytes. It is cropped to its centered square, scaled down to at
// most MaxAvatarEdge pixels and stored as JPEG.
//
// A body larger than MaxAvatarBytes gives an error that matches
// apperr.ErrTooLarge; a wrong Content-Type or bad image data gives an
// apperr validation error.
func (s *Service) SetAvatar(ctx context.Context, userID uint, contentType string, body io.Reader) error {
	format, err := imaging.Format(contentType)
	if err != nil {
		return err
	}
	data, err := readAvatar(body)
	if err != nil {
		return err
	}
	var img imaging.Result
	err = s.decoder.Do(ctx, func() error {
		var err error
		img, err = imaging.Process(data, format, imaging.Options{
			MaxEdge: MaxAvatarEdge,
			Square:  true,
			Quality: avatarJPEGQuality,
		})
		return err
	})
	if err != nil {
		return err
	}
	return s.store.UpsertAvatar(ctx, &Avatar{UserID: userID, Data: img.Data, MimeType: img.MimeType})
}

// DeleteAvatar removes the avatar of the user. No avatar is not an error.
func (s *Service) DeleteAvatar(ctx context.Context, userID uint) error {
	return s.store.DeleteAvatar(ctx, userID)
}

// Avatar returns the avatar of the user, or apperr.ErrNotFound.
func (s *Service) Avatar(ctx context.Context, userID uint) (*Avatar, error) {
	return s.store.FindAvatar(ctx, userID)
}

// AvatarVersion returns the version of the avatar of the user (unix
// milliseconds of its UpdatedAt), or nil if the user has no avatar. It
// implements auth.AvatarVersions.
func (s *Service) AvatarVersion(ctx context.Context, userID uint) (*int64, error) {
	updatedAt, err := s.store.AvatarUpdatedAt(ctx, userID)
	if errors.Is(err, apperr.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v := updatedAt.UnixMilli()
	return &v, nil
}

// readAvatar reads an uploaded avatar file of at most MaxAvatarBytes.
func readAvatar(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, MaxAvatarBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read avatar upload: %w", err)
	}
	if len(data) > MaxAvatarBytes {
		return nil, fmt.Errorf("avatar is larger than %d MiB: %w", MaxAvatarBytes>>20, apperr.ErrTooLarge)
	}
	if len(data) == 0 {
		return nil, apperr.Validation("the uploaded file is empty")
	}
	return data, nil
}
