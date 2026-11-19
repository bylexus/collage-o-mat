// Package quota resolves the photo storage limit of a user and builds the
// error and the texts for it. The limit is the user's own value
// (users.max_storage_bytes) or, if it is not set, the server default
// (settings.Settings.MaxUserStorageBytes); 0 = unlimited in both places.
//
// The package does not import the photo, collage, admin or profile packages:
// they import it for Exceeds, Effective, the errors and FormatBytes, and get
// the Service through their own small interfaces (wired in main.go). The
// check that really protects the limit runs in the transaction that inserts
// a photo (photo.GormStore).
package quota

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"collageomat/internal/apperr"
	"collageomat/internal/settings"
)

// Store gives the own limit of a user (implemented by GormStore).
type Store interface {
	// MaxStorageBytes returns the own limit of the user, or nil if the user
	// uses the server default. An unknown user gives apperr.ErrNotFound.
	MaxStorageBytes(ctx context.Context, userID uint) (*int64, error)
}

// UsedBytes gives the stored photo bytes of users (implemented by
// photo.GormStore).
type UsedBytes interface {
	// UsedBytesByUser returns the sum of the sizes of the photos of all
	// collages of the user.
	UsedBytesByUser(ctx context.Context, userID uint) (int64, error)
	// UsedBytesAllUsers returns the used bytes per user id (all users).
	// Users without photos may be missing (0 bytes).
	UsedBytesAllUsers(ctx context.Context) (map[uint]int64, error)
}

// Settings gives the system settings with the server default (implemented
// by *settings.Service).
type Settings interface {
	Get(ctx context.Context) (settings.Settings, error)
}

// Service resolves the effective storage limit and the usage of a user.
type Service struct {
	store    Store
	used     UsedBytes
	settings Settings
}

// NewService returns a quota service.
func NewService(store Store, used UsedBytes, settings Settings) *Service {
	return &Service{store: store, used: used, settings: settings}
}

// Limit returns the effective storage limit of the user in bytes: the own
// limit if it is set, else the server default. 0 = unlimited.
func (s *Service) Limit(ctx context.Context, userID uint) (int64, error) {
	own, err := s.store.MaxStorageBytes(ctx, userID)
	if err != nil {
		return 0, err
	}
	if own != nil {
		return *own, nil
	}
	return s.DefaultLimit(ctx)
}

// DefaultLimit returns the server default limit in bytes (system setting
// maxUserStorageBytes); 0 = unlimited.
func (s *Service) DefaultLimit(ctx context.Context) (int64, error) {
	st, err := s.settings.Get(ctx)
	if err != nil {
		return 0, err
	}
	return st.MaxUserStorageBytes, nil
}

// UsedBytesAllUsers returns the used photo bytes per user id with one
// grouped query. Users without photos may be missing (0 bytes).
func (s *Service) UsedBytesAllUsers(ctx context.Context) (map[uint]int64, error) {
	return s.used.UsedBytesAllUsers(ctx)
}

// Usage returns the used photo bytes and the effective limit of the user
// (see Limit).
func (s *Service) Usage(ctx context.Context, userID uint) (used, limit int64, err error) {
	limit, err = s.Limit(ctx, userID)
	if err != nil {
		return 0, 0, err
	}
	used, err = s.used.UsedBytesByUser(ctx, userID)
	if err != nil {
		return 0, 0, err
	}
	return used, limit, nil
}

// Effective returns the effective limit of a user: own if it is set, else
// def (the server default). 0 = unlimited.
func Effective(own *int64, def int64) int64 {
	if own != nil {
		return *own
	}
	return def
}

// Exceeds reports whether used + needed bytes are more than limit. A limit
// of 0 (unlimited) is never exceeded.
func Exceeds(used, needed, limit int64) bool {
	return limit > 0 && used+needed > limit
}

// Full reports whether no byte can be added: used is limit or more. A limit
// of 0 (unlimited) is never full.
func Full(used, limit int64) bool {
	return limit > 0 && used >= limit
}

// FullError returns the apperr conflict (HTTP 409) for a user who is
// already at or over the limit, e.g. "storage limit reached: 2 GB of 2 GB
// used".
func FullError(used, limit int64) error {
	return apperr.Conflict("storage limit reached: %s of %s used", FormatBytes(used), FormatBytes(limit))
}

// PhotoError returns the apperr conflict (HTTP 409) for a new photo of
// needed bytes that does not fit, e.g. "storage limit reached: 1.95 GB of
// 2 GB used, the photo needs 3.1 MB". used is without the photo.
func PhotoError(used, limit, needed int64) error {
	return apperr.Conflict("storage limit reached: %s of %s used, the photo needs %s",
		FormatBytes(used), FormatBytes(limit), FormatBytes(needed))
}

// CopyError returns the apperr conflict (HTTP 409) for a collage copy of
// needed bytes that does not fit ("..., the copy needs 120 MB").
func CopyError(used, limit, needed int64) error {
	return apperr.Conflict("storage limit reached: %s of %s used, the copy needs %s",
		FormatBytes(used), FormatBytes(limit), FormatBytes(needed))
}

// FormatBytes formats n with decimal units (1 GB = 10^9 bytes) and at most
// two decimals without trailing zeros, e.g. "1.95 GB", "2 GB", "3.1 MB",
// "12.35 kB" or "512 B".
func FormatBytes(n int64) string {
	const unit = 1000
	if n < unit {
		return strconv.FormatInt(n, 10) + " B"
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit && exp < 3; m /= unit {
		div *= unit
		exp++
	}
	s := strconv.FormatFloat(float64(n)/float64(div), 'f', 2, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	return fmt.Sprintf("%s %cB", s, "kMGT"[exp])
}

// FormatLimit formats a limit like FormatBytes; 0 gives "unlimited".
func FormatLimit(limit int64) string {
	if limit == 0 {
		return "unlimited"
	}
	return FormatBytes(limit)
}
