// Package admin contains the user management of the admin section: list,
// create, edit (admin role, active flag, new password) and delete users.
// The users and sessions tables belong to the auth package; the collages,
// photos and avatars of a user are reached only through the interfaces
// Collages, Usage and Avatars.
package admin

import (
	"context"
	"errors"
	"fmt"

	"collageomat/internal/apperr"
	"collageomat/internal/auth"
	"collageomat/internal/collage"
	"collageomat/internal/profile"
)

const (
	msgSelfAdmin    = "you cannot change your own admin role"
	msgSelfActive   = "you cannot deactivate your own account"
	msgSelfPassword = "you cannot set your own password here; use the Profile page"
	msgSelfDelete   = "you cannot delete your own account"
	msgLastAdmin    = "at least one active admin must remain"
)

// Store is the persistence the service needs (implemented by GormStore).
type Store interface {
	ListUsers(ctx context.Context) ([]auth.User, error)
	// FindUser returns apperr.ErrNotFound if the user does not exist.
	FindUser(ctx context.Context, id uint) (*auth.User, error)
	UsernameExists(ctx context.Context, username string) (bool, error)
	CreateUser(ctx context.Context, u *auth.User) error
	// UpdateUser returns apperr.ErrNotFound if the user does not exist. An
	// empty passwordHash keeps the password.
	UpdateUser(ctx context.Context, id uint, isAdmin, isActive bool, passwordHash string) error
	DeleteSessions(ctx context.Context, userID uint) error
	// DeleteUser returns apperr.ErrNotFound if the user does not exist.
	DeleteUser(ctx context.Context, id uint) error
	CountActiveAdmins(ctx context.Context) (int64, error)
}

// Collages is the part of the collage domain that the user delete needs.
// The collage package implements it (*collage.Service), main.go wires it.
type Collages interface {
	// List returns the collages of the user.
	List(ctx context.Context, userID uint) ([]collage.Summary, error)
	// Delete deletes the collage with its photo rows and photo files.
	Delete(ctx context.Context, userID, id uint) error
}

// Usage gives the collage and photo counts of the user list. The collage
// package implements it (collage.UserUsage), main.go wires it.
type Usage interface {
	// CountsByUser returns the number of collages and of photos per user
	// id. Users without collages may be missing (count 0).
	CountsByUser(ctx context.Context) (collages, photos map[uint]int, err error)
}

// Avatars gives the avatar of any user. The profile package implements it
// (*profile.Service), main.go wires it.
type Avatars interface {
	// Avatar returns apperr.ErrNotFound if the user has no avatar.
	Avatar(ctx context.Context, userID uint) (*profile.Avatar, error)
	// AvatarVersion returns nil if the user has no avatar.
	AvatarVersion(ctx context.Context, userID uint) (*int64, error)
}

// Transactor runs fn in one database transaction: all store calls with the
// context passed to fn are part of it (implemented by db.Transactor).
type Transactor interface {
	InTx(ctx context.Context, fn func(ctx context.Context) error) error
}

// UserSummary is a user with its avatar version and usage counts (list
// entry; create and update return it too).
type UserSummary struct {
	auth.User
	// AvatarVersion is nil if the user has no avatar.
	AvatarVersion *int64
	CollageCount  int
	PhotoCount    int
}

// Update is the new state of a user (edit dialog).
type Update struct {
	IsAdmin  bool
	IsActive bool
	// NewPassword is the new password; empty keeps the password.
	NewPassword string
}

// Service holds the user management rules. Every changing method takes the
// id of the logged-in admin (actorID) for the self-protection rules: an
// admin cannot demote, deactivate or delete their own account or set their
// own password here. After every change at least one active admin must
// remain.
type Service struct {
	store    Store
	collages Collages
	usage    Usage
	avatars  Avatars
	tx       Transactor
}

// NewService returns the admin service.
func NewService(store Store, collages Collages, usage Usage, avatars Avatars, tx Transactor) *Service {
	return &Service{store: store, collages: collages, usage: usage, avatars: avatars, tx: tx}
}

// ListUsers returns all users with avatar versions and counts, ordered by
// username.
func (s *Service) ListUsers(ctx context.Context) ([]UserSummary, error) {
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	collages, photos, err := s.usage.CountsByUser(ctx)
	if err != nil {
		return nil, fmt.Errorf("count usage of users: %w", err)
	}
	out := make([]UserSummary, len(users))
	for i, u := range users {
		version, err := s.avatars.AvatarVersion(ctx, u.ID)
		if err != nil {
			return nil, fmt.Errorf("avatar version of user %d: %w", u.ID, err)
		}
		out[i] = UserSummary{User: u, AvatarVersion: version, CollageCount: collages[u.ID], PhotoCount: photos[u.ID]}
	}
	return out, nil
}

// CreateUser creates a new active user. An invalid username or password
// gives an apperr validation error, an existing username apperr.Conflict.
func (s *Service) CreateUser(ctx context.Context, username, password string, isAdmin bool) (*UserSummary, error) {
	name, err := auth.NormalizeUsername(username)
	if err != nil {
		return nil, apperr.Validation("%s", err.Error())
	}
	hash, err := hashValidPassword(password)
	if err != nil {
		return nil, err
	}
	u := auth.User{Username: name, PasswordHash: hash, IsAdmin: isAdmin, IsActive: true}
	err = s.tx.InTx(ctx, func(ctx context.Context) error {
		exists, err := s.store.UsernameExists(ctx, name)
		if err != nil {
			return err
		}
		if exists {
			return apperr.Conflict("username %q is already taken", name)
		}
		return s.store.CreateUser(ctx, &u)
	})
	if err != nil {
		return nil, err
	}
	return &UserSummary{User: u}, nil
}

// UpdateUser sets the admin and active flags and, if given, a new password
// of the user id in one transaction. Deactivating the user or setting a new
// password deletes all sessions of the user. Errors: apperr.ErrNotFound
// for an unknown user, apperr.Conflict for a self-protection rule or if no
// active admin would remain, an apperr validation error for an invalid
// password.
func (s *Service) UpdateUser(ctx context.Context, actorID, id uint, upd Update) (*UserSummary, error) {
	self := actorID == id
	var hash string
	if upd.NewPassword != "" {
		if self {
			return nil, apperr.Conflict(msgSelfPassword)
		}
		var err error
		if hash, err = hashValidPassword(upd.NewPassword); err != nil {
			return nil, err
		}
	}
	err := s.tx.InTx(ctx, func(ctx context.Context) error {
		u, err := s.store.FindUser(ctx, id)
		if err != nil {
			return err
		}
		if self && upd.IsAdmin != u.IsAdmin {
			return apperr.Conflict(msgSelfAdmin)
		}
		if self && upd.IsActive != u.IsActive {
			return apperr.Conflict(msgSelfActive)
		}
		if err := s.store.UpdateUser(ctx, id, upd.IsAdmin, upd.IsActive, hash); err != nil {
			return err
		}
		if !upd.IsActive || hash != "" {
			if err := s.store.DeleteSessions(ctx, id); err != nil {
				return err
			}
		}
		return s.ensureActiveAdmin(ctx)
	})
	if err != nil {
		return nil, err
	}
	return s.summary(ctx, id)
}

// DeleteUser deletes the user id with all data: first each collage through
// Collages.Delete (photo rows and files), then the users row (the foreign
// keys remove connectors, avatar, sessions and the remaining rows). A
// failed call can be repeated: collages that are already gone are not
// listed again. Errors: apperr.ErrNotFound for an unknown user,
// apperr.Conflict for the own account or if no active admin would remain.
func (s *Service) DeleteUser(ctx context.Context, actorID, id uint) error {
	if actorID == id {
		return apperr.Conflict(msgSelfDelete)
	}
	// Check the rules before any data is removed, and log the user out so
	// that no new collages appear while they are deleted.
	err := s.tx.InTx(ctx, func(ctx context.Context) error {
		u, err := s.store.FindUser(ctx, id)
		if err != nil {
			return err
		}
		if u.IsAdmin && u.IsActive {
			n, err := s.store.CountActiveAdmins(ctx)
			if err != nil {
				return err
			}
			if n <= 1 {
				return apperr.Conflict(msgLastAdmin)
			}
		}
		return s.store.DeleteSessions(ctx, id)
	})
	if err != nil {
		return err
	}

	collages, err := s.collages.List(ctx, id)
	if err != nil {
		return fmt.Errorf("list collages of user %d: %w", id, err)
	}
	for _, c := range collages {
		err := s.collages.Delete(ctx, id, c.ID)
		if err != nil && !errors.Is(err, apperr.ErrNotFound) {
			return fmt.Errorf("delete collage %d of user %d: %w", c.ID, id, err)
		}
	}

	return s.tx.InTx(ctx, func(ctx context.Context) error {
		if err := s.store.DeleteUser(ctx, id); err != nil {
			return err
		}
		return s.ensureActiveAdmin(ctx)
	})
}

// Avatar returns the avatar of the user id, or apperr.ErrNotFound.
func (s *Service) Avatar(ctx context.Context, id uint) (*profile.Avatar, error) {
	return s.avatars.Avatar(ctx, id)
}

// summary returns the list entry of the user id.
func (s *Service) summary(ctx context.Context, id uint) (*UserSummary, error) {
	u, err := s.store.FindUser(ctx, id)
	if err != nil {
		return nil, err
	}
	collages, photos, err := s.usage.CountsByUser(ctx)
	if err != nil {
		return nil, fmt.Errorf("count usage of users: %w", err)
	}
	version, err := s.avatars.AvatarVersion(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("avatar version of user %d: %w", id, err)
	}
	return &UserSummary{User: *u, AvatarVersion: version, CollageCount: collages[id], PhotoCount: photos[id]}, nil
}

// ensureActiveAdmin returns apperr.Conflict if no active admin is left. Call
// it in the transaction of the change, after the change.
func (s *Service) ensureActiveAdmin(ctx context.Context) error {
	n, err := s.store.CountActiveAdmins(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return apperr.Conflict(msgLastAdmin)
	}
	return nil
}

// hashValidPassword checks the password rules (apperr validation error)
// and returns the bcrypt hash.
func hashValidPassword(password string) (string, error) {
	if err := auth.ValidatePassword(password); err != nil {
		return "", apperr.Validation("%s", err.Error())
	}
	return auth.HashPassword(password)
}
