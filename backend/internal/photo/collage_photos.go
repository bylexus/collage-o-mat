package photo

import (
	"context"
	"fmt"

	"collageomat/internal/apperr"
	"collageomat/internal/collage"
)

// CollagePhotos implements collage.Photos: the photo operations the collage
// service needs. The collage service checks ownership before it calls them.
// It works on the store and the files directly (not on Service), because
// Service itself depends on the collage service.
type CollagePhotos struct {
	store Store
	files FileStorage
}

var _ collage.Photos = (*CollagePhotos)(nil)

// NewCollagePhotos returns the collage.Photos adapter.
func NewCollagePhotos(store Store, files FileStorage) *CollagePhotos {
	return &CollagePhotos{store: store, files: files}
}

// CountByCollages implements collage.Photos.
func (c *CollagePhotos) CountByCollages(ctx context.Context, collageIDs []uint) (map[uint]int, error) {
	return c.store.CountByCollages(ctx, collageIDs)
}

// ListForCollage implements collage.Photos.
func (c *CollagePhotos) ListForCollage(ctx context.Context, collageID uint) ([]collage.PhotoView, error) {
	photos, err := c.store.ListByCollage(ctx, collageID)
	if err != nil {
		return nil, err
	}
	return views(photos), nil
}

// UpdateProps implements collage.Photos: it sets the props of each listed
// photo. A photo that is not in the collage gives an apperr validation
// error; the photos updated before stay changed unless ctx carries a
// transaction (the collage service runs it in one).
func (c *CollagePhotos) UpdateProps(ctx context.Context, collageID uint, updates []collage.PhotoPropsUpdate) error {
	for _, u := range updates {
		found, err := c.store.UpdatePropsInCollage(ctx, collageID, u.ID, u.Props)
		if err != nil {
			return err
		}
		if !found {
			return apperr.Validation("unknown photo id %d", u.ID)
		}
	}
	return nil
}

// DeleteAllForCollage implements collage.Photos: it deletes the rows, then
// the collage's photo directory. Both steps are idempotent, so a failed
// call can be repeated.
func (c *CollagePhotos) DeleteAllForCollage(ctx context.Context, collageID uint) error {
	if err := c.store.DeleteByCollage(ctx, collageID); err != nil {
		return err
	}
	if err := c.files.RemoveDir(collageDir(collageID)); err != nil {
		return fmt.Errorf("remove photo files of collage %d: %w", collageID, err)
	}
	return nil
}
