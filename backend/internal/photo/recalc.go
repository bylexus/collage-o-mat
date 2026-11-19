package photo

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
)

// UserSizes is the result of RecalcSizes for one user.
type UserSizes struct {
	UserID   uint
	Username string
	// Updated, Unchanged and Missing count the photos of the user: size
	// changed, size was correct, file does not exist (row not changed).
	Updated   int
	Unchanged int
	Missing   int
	// MissingFiles are the file names of the missing photos.
	MissingFiles []string
	// UsedBytes is the sum of the sizes of the user's photos after the
	// recalculation (missing photos count with their unchanged size).
	UsedBytes int64
}

// RecalcSizes sets size_bytes of the photos of the user username (or of all
// users if username is "") to the size of the file in files. A missing file
// is counted and its row is not changed. It is used by the CLI
// "collageomat photos recalc-size". An unknown username gives an error.
func RecalcSizes(ctx context.Context, store *GormStore, files FileStorage, username string) ([]UserSizes, error) {
	users, err := store.ListUsers(ctx, username)
	if err != nil {
		return nil, err
	}
	out := make([]UserSizes, 0, len(users))
	for _, u := range users {
		res, err := recalcUser(ctx, store, files, u.ID)
		if err != nil {
			return nil, err
		}
		res.Username = u.Username
		out = append(out, res)
	}
	return out, nil
}

// recalcUser recalculates the sizes of the photos of one user.
func recalcUser(ctx context.Context, store *GormStore, files FileStorage, userID uint) (UserSizes, error) {
	res := UserSizes{UserID: userID}
	photos, err := store.ListByUser(ctx, userID)
	if err != nil {
		return res, err
	}
	for _, p := range photos {
		size, err := files.Size(p.FileName)
		if errors.Is(err, fs.ErrNotExist) {
			res.Missing++
			res.MissingFiles = append(res.MissingFiles, p.FileName)
			res.UsedBytes += p.SizeBytes
			continue
		}
		if err != nil {
			return res, fmt.Errorf("size of photo %d: %w", p.ID, err)
		}
		res.UsedBytes += size
		if size == p.SizeBytes {
			res.Unchanged++
			continue
		}
		if err := store.UpdateSize(ctx, p.ID, size); err != nil {
			return res, err
		}
		res.Updated++
	}
	return res, nil
}
