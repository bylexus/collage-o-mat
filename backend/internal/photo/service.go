package photo

import (
	"bytes"
	"cmp"
	"context"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"

	"collageomat/internal/apperr"
	"collageomat/internal/collage"
	"collageomat/internal/jsoncol"
)

const (
	// MaxImportAssets is the maximum number of assets in one import request.
	MaxImportAssets = 500
	// maxAssetIDLength is the maximum length of a source asset ID.
	maxAssetIDLength = 200
	// importWorkers is the number of parallel downloads of an import.
	importWorkers = 4
)

// Store is the persistence the Service needs (implemented by GormStore).
type Store interface {
	// CreateWithFile inserts p, calls writeFile with p.ID set (writeFile sets
	// p.FileName and writes the file) and saves p.FileName, all database
	// steps in one transaction.
	CreateWithFile(ctx context.Context, p *Photo, writeFile func(p *Photo) error) error
	// FindInCollage returns apperr.ErrNotFound if the photo does not exist
	// or belongs to another collage.
	FindInCollage(ctx context.Context, collageID, id uint) (*Photo, error)
	ListByCollage(ctx context.Context, collageID uint) ([]Photo, error)
	ExistingSourceAssetIDs(ctx context.Context, collageID, connectorID uint, assetIDs []string) ([]string, error)
	CountByCollages(ctx context.Context, collageIDs []uint) (map[uint]int, error)
	Delete(ctx context.Context, id uint) error
	DeleteByCollage(ctx context.Context, collageID uint) error
}

// FileStorage stores the photo files (implemented by DiskStorage). Paths
// are relative to the photo directory.
type FileStorage interface {
	// Save writes r to relPath atomically.
	Save(relPath string, r io.Reader) error
	Open(relPath string) (io.ReadSeekCloser, error)
	// Remove and RemoveDir ignore missing files.
	Remove(relPath string) error
	RemoveDir(relDir string) error
}

// Collages checks that a collage belongs to the user (implemented by
// *collage.Service).
type Collages interface {
	// Get returns apperr.ErrNotFound if the collage does not exist or
	// belongs to another user.
	Get(ctx context.Context, userID, id uint) (*collage.Collage, error)
}

// Sources gives access to the photo source behind a connector (implemented
// by the Immich connector, immich.Service).
type Sources interface {
	// Source returns the source of a connector of the user. It returns
	// apperr.ErrNotFound if the connector does not exist or belongs to
	// another user, and an apperr validation error if photos cannot be
	// imported from this connector type.
	Source(ctx context.Context, userID, connectorID uint) (Source, error)
}

// Source downloads images of one connector.
type Source interface {
	// Preview returns the preview image of an asset and its Content-Type.
	// The caller must close the reader. Problems of the source are apperr
	// upstream errors.
	Preview(ctx context.Context, assetID string) (io.ReadCloser, string, error)
}

// ImportResult is the result of an import.
type ImportResult struct {
	// Photos are the newly imported photos, id ascending.
	Photos []Photo
	// Skipped is the number of requested assets that were already in the
	// collage (same connector and asset ID).
	Skipped int
}

// Service contains the business rules for photos. Every method takes the id
// of the logged-in user; photos of collages of other users give
// apperr.ErrNotFound.
type Service struct {
	store    Store
	files    FileStorage
	collages Collages
	sources  Sources
}

// NewService returns a photo service.
func NewService(store Store, files FileStorage, collages Collages, sources Sources) *Service {
	return &Service{store: store, files: files, collages: collages, sources: sources}
}

// Import copies the preview images of the given assets of a connector into
// the collage. Assets that are already in the collage are skipped; duplicate
// IDs in assetIDs are imported once. Up to importWorkers downloads run in
// parallel.
//
// If an asset fails, no further downloads are started and the error names
// the asset; downloads that are already running are finished. Photos that
// were imported before the error stay in the collage (a repeated request
// skips them).
func (s *Service) Import(ctx context.Context, userID, collageID, connectorID uint, assetIDs []string) (ImportResult, error) {
	if _, err := s.collages.Get(ctx, userID, collageID); err != nil {
		return ImportResult{}, err
	}
	if connectorID == 0 {
		return ImportResult{}, apperr.Validation("connectorId is required")
	}
	ids, err := normalizeAssetIDs(assetIDs)
	if err != nil {
		return ImportResult{}, err
	}
	src, err := s.sources.Source(ctx, userID, connectorID)
	if err != nil {
		return ImportResult{}, err
	}
	existing, err := s.store.ExistingSourceAssetIDs(ctx, collageID, connectorID, ids)
	if err != nil {
		return ImportResult{}, err
	}
	skip := make(map[string]bool, len(existing))
	for _, id := range existing {
		skip[id] = true
	}
	todo := slices.DeleteFunc(ids, func(id string) bool { return skip[id] })

	photos, err := s.importAll(ctx, src, collageID, connectorID, todo)
	slices.SortFunc(photos, func(a, b Photo) int { return cmp.Compare(a.ID, b.ID) })
	return ImportResult{Photos: photos, Skipped: len(existing)}, err
}

// importAll imports the assets with importWorkers parallel workers. It
// returns the imported photos and the first error.
func (s *Service) importAll(ctx context.Context, src Source, collageID, connectorID uint, assetIDs []string) ([]Photo, error) {
	var (
		mu       sync.Mutex
		photos   = make([]Photo, 0, len(assetIDs))
		firstErr error
		wg       sync.WaitGroup
	)
	failed := make(chan struct{}) // closed on the first error
	fail := func(err error) {
		mu.Lock()
		defer mu.Unlock()
		if firstErr == nil {
			firstErr = err
			close(failed)
		}
	}

	jobs := make(chan string)
	for range min(importWorkers, len(assetIDs)) {
		wg.Go(func() {
			for assetID := range jobs {
				if isClosed(failed) {
					continue
				}
				p, err := s.importOne(ctx, src, collageID, connectorID, assetID)
				if err != nil {
					fail(assetError(assetID, err))
					continue
				}
				mu.Lock()
				photos = append(photos, p)
				mu.Unlock()
			}
		})
	}
feed:
	for _, assetID := range assetIDs {
		select {
		case jobs <- assetID:
		case <-failed:
			break feed
		}
	}
	close(jobs)
	wg.Wait()
	return photos, firstErr
}

// importOne downloads and checks the preview of one asset, then creates the
// photo row and file together.
func (s *Service) importOne(ctx context.Context, src Source, collageID, connectorID uint, assetID string) (Photo, error) {
	img, err := download(ctx, src, assetID)
	if err != nil {
		return Photo{}, err
	}
	p := Photo{
		CollageID:     collageID,
		ConnectorID:   &connectorID,
		SourceAssetID: assetID,
		MimeType:      img.mimeType,
		WidthPx:       img.width,
		HeightPx:      img.height,
		Props:         jsoncol.JSON("{}"),
	}
	written := false
	err = s.store.CreateWithFile(ctx, &p, func(p *Photo) error {
		p.FileName = fileName(collageID, p.ID, img.ext)
		if err := s.files.Save(p.FileName, bytes.NewReader(img.data)); err != nil {
			return err
		}
		written = true
		return nil
	})
	if err != nil {
		if written {
			// The row was rolled back; the file must go too.
			s.removeFile(p.FileName)
		}
		return Photo{}, err
	}
	return p, nil
}

// download fetches and checks the preview image of an asset.
func download(ctx context.Context, src Source, assetID string) (preview, error) {
	body, contentType, err := src.Preview(ctx, assetID)
	if err != nil {
		return preview{}, err
	}
	defer body.Close()
	return readPreview(body, contentType)
}

// assetError adds the asset ID to an import error. Upstream errors keep
// their kind, so the client sees the asset ID and the reason.
func assetError(assetID string, err error) error {
	if _, ok := apperr.AsUpstream(err); ok {
		return apperr.Upstream("import of asset %q failed: %w", assetID, err)
	}
	return fmt.Errorf("import asset %q: %w", assetID, err)
}

// Delete deletes a photo of a collage of the user (row and file).
func (s *Service) Delete(ctx context.Context, userID, collageID, photoID uint) error {
	p, err := s.find(ctx, userID, collageID, photoID)
	if err != nil {
		return err
	}
	if err := s.store.Delete(ctx, p.ID); err != nil {
		return err
	}
	// The row is gone, so a retry would give 404; a left-over file is
	// harmless and only logged.
	s.removeFile(p.FileName)
	return nil
}

// OpenFile returns a photo of a collage of the user and its opened file.
// The caller must close the file.
func (s *Service) OpenFile(ctx context.Context, userID, collageID, photoID uint) (*Photo, io.ReadSeekCloser, error) {
	p, err := s.find(ctx, userID, collageID, photoID)
	if err != nil {
		return nil, nil, err
	}
	f, err := s.files.Open(p.FileName)
	if err != nil {
		return nil, nil, fmt.Errorf("open file of photo %d: %w", p.ID, err)
	}
	return p, f, nil
}

// find returns a photo after checking that the collage belongs to the user.
func (s *Service) find(ctx context.Context, userID, collageID, photoID uint) (*Photo, error) {
	if _, err := s.collages.Get(ctx, userID, collageID); err != nil {
		return nil, err
	}
	return s.store.FindInCollage(ctx, collageID, photoID)
}

// removeFile deletes a photo file and logs a failure.
func (s *Service) removeFile(relPath string) {
	if err := s.files.Remove(relPath); err != nil {
		slog.Warn("remove photo file", "file", relPath, "err", err)
	}
}

// normalizeAssetIDs trims the IDs, removes duplicates (first one wins) and
// checks count and length.
func normalizeAssetIDs(assetIDs []string) ([]string, error) {
	ids := make([]string, 0, len(assetIDs))
	seen := make(map[string]bool, len(assetIDs))
	for _, id := range assetIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, apperr.Validation("assetIds must not contain empty values")
		}
		if len(id) > maxAssetIDLength {
			return nil, apperr.Validation("asset ID is longer than %d characters", maxAssetIDLength)
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, apperr.Validation("assetIds must contain at least one asset ID")
	}
	if len(ids) > MaxImportAssets {
		return nil, apperr.Validation("at most %d assets can be imported at once", MaxImportAssets)
	}
	return ids, nil
}

// fileName returns the path of a photo file relative to the photo directory:
// "<collageId>/<photoId><ext>".
func fileName(collageID, photoID uint, ext string) string {
	return collageDir(collageID) + "/" + strconv.FormatUint(uint64(photoID), 10) + ext
}

// collageDir returns the directory of a collage's photo files relative to
// the photo directory.
func collageDir(collageID uint) string {
	return strconv.FormatUint(uint64(collageID), 10)
}

// isClosed reports whether ch is closed.
func isClosed(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}
