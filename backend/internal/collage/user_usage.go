package collage

import (
	"context"
	"fmt"
)

// UserUsage gives the number of collages and photos per user (implements
// admin.Usage). It works on the store and the Photos adapter directly; the
// collage package does not import the admin package.
type UserUsage struct {
	store  Store
	photos Photos
}

// NewUserUsage returns the admin.Usage adapter.
func NewUserUsage(store Store, photos Photos) *UserUsage {
	return &UserUsage{store: store, photos: photos}
}

// CountsByUser returns the number of collages and of photos per user id.
// Users without collages are missing in both maps (count 0). It runs two
// grouped queries, independent of the number of users.
func (u *UserUsage) CountsByUser(ctx context.Context) (collages, photos map[uint]int, err error) {
	owners, err := u.store.OwnerByCollage(ctx)
	if err != nil {
		return nil, nil, err
	}
	perCollage, err := u.photos.CountAllByCollage(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("count photos of all collages: %w", err)
	}
	collages = make(map[uint]int)
	photos = make(map[uint]int)
	for collageID, userID := range owners {
		collages[userID]++
		photos[userID] += perCollage[collageID]
	}
	return collages, photos, nil
}
