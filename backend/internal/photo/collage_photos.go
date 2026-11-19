package photo

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"path"

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

// StatsByCollages implements collage.Photos.
func (c *CollagePhotos) StatsByCollages(ctx context.Context, collageIDs []uint) (map[uint]collage.PhotoStats, error) {
	stats, err := c.store.StatsByCollages(ctx, collageIDs)
	if err != nil {
		return nil, err
	}
	out := make(map[uint]collage.PhotoStats, len(stats))
	for id, st := range stats {
		out[id] = collage.PhotoStats{Count: st.Count, SizeBytes: st.SizeBytes}
	}
	return out, nil
}

// SizeByCollage implements collage.Photos.
func (c *CollagePhotos) SizeByCollage(ctx context.Context, collageID uint) (int64, error) {
	return c.store.SizeByCollage(ctx, collageID)
}

// CountAllByCollage implements collage.Photos.
func (c *CollagePhotos) CountAllByCollage(ctx context.Context) (map[uint]int, error) {
	return c.store.CountAllByCollage(ctx)
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

// CopyAllForCollage implements collage.Photos: it copies the photos of
// srcCollageID to dstCollageID, id ascending. Each copy is a new row with
// the same connector, source asset ID, MIME type, size and props, and a
// stream copy of the file at fileName(dst, newID, ext of the source file).
// SizeBytes of the copy is the number of bytes copied. Each copy is checked
// against the storage limit of userID (limit in bytes, 0 = unlimited; see
// Store.CreateWithFile): a copy that does not fit gives a quota.PhotoError
// (apperr conflict).
//
// A photo whose source file does not exist (fs.ErrNotExist) is skipped with
// a warning in the log and counted. Every other error stops the copy and is
// returned; the files written before are not removed (the caller removes the
// destination collage's photo directory with DeleteAllForCollage).
func (c *CollagePhotos) CopyAllForCollage(ctx context.Context, srcCollageID, dstCollageID, userID uint, limit int64) (map[uint]uint, int, error) {
	photos, err := c.store.ListByCollage(ctx, srcCollageID)
	if err != nil {
		return nil, 0, err
	}
	idMap := make(map[uint]uint, len(photos))
	skipped := 0
	for i := range photos {
		newID, ok, err := c.copyPhoto(ctx, &photos[i], dstCollageID, Quota{UserID: userID, Limit: limit})
		if err != nil {
			return nil, 0, err
		}
		if !ok {
			skipped++
			continue
		}
		idMap[photos[i].ID] = newID
	}
	return idMap, skipped, nil
}

// copyPhoto copies src (row and file) into the collage dstCollageID,
// checked against the storage limit q, and returns the new photo id. It returns ok == false (and no error) if the
// source file does not exist.
func (c *CollagePhotos) copyPhoto(ctx context.Context, src *Photo, dstCollageID uint, q Quota) (newID uint, ok bool, err error) {
	in, err := c.files.Open(src.FileName)
	if errors.Is(err, fs.ErrNotExist) {
		slog.Warn("duplicate collage: photo file missing, photo skipped",
			"collage", src.CollageID, "photo", src.ID, "file", src.FileName)
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("open file of photo %d: %w", src.ID, err)
	}
	defer func() { _ = in.Close() }()

	p := Photo{
		CollageID:     dstCollageID,
		ConnectorID:   src.ConnectorID,
		SourceAssetID: src.SourceAssetID,
		MimeType:      src.MimeType,
		WidthPx:       src.WidthPx,
		HeightPx:      src.HeightPx,
		Props:         src.Props,
	}
	ext := path.Ext(src.FileName)
	err = c.store.CreateWithFile(ctx, &p, q, func(p *Photo) error {
		p.FileName = fileName(dstCollageID, p.ID, ext)
		counter := &countingReader{r: in}
		if err := c.files.Save(p.FileName, counter); err != nil {
			return fmt.Errorf("copy file of photo %d: %w", src.ID, err)
		}
		p.SizeBytes = counter.n
		return nil
	})
	if err != nil {
		return 0, false, err
	}
	return p.ID, true, nil
}

// countingReader counts the bytes read from r.
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(b []byte) (int, error) {
	n, err := c.r.Read(b)
	c.n += int64(n)
	return n, err
}
