package photo

import (
	"bytes"
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"

	"collageomat/internal/apperr"
	"collageomat/internal/collage"
	"collageomat/internal/imaging"
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
	// UploadExists reports whether the collage has an uploaded photo (no
	// connector) with the source asset ID.
	UploadExists(ctx context.Context, collageID uint, sourceAssetID string) (bool, error)
	CountByCollages(ctx context.Context, collageIDs []uint) (map[uint]int, error)
	// UpdatePropsInCollage returns false if the photo does not exist or
	// belongs to another collage.
	UpdatePropsInCollage(ctx context.Context, collageID, id uint, props jsoncol.JSON) (bool, error)
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
	// Image returns the image of an asset in the given size. The caller
	// must close SourceImage.Body. Problems of the source are apperr
	// upstream errors.
	Image(ctx context.Context, assetID string, size ImageSize) (SourceImage, error)
}

// SourceImage is an image downloaded from a Source.
type SourceImage struct {
	// Body is the image data. The caller must close it.
	Body io.ReadCloser
	// ContentType is the Content-Type of the image (e.g. "image/jpeg").
	ContentType string
	// Fallback is true if SizeOriginal was requested, but the source could
	// only deliver the preview.
	Fallback bool
}

// ImageSize is the image size of an import from a Source.
type ImageSize string

// Image sizes of an import.
const (
	// SizePreview is the big preview of the source (Immich: about 1440 px).
	SizePreview ImageSize = "preview"
	// SizeOriginal is the original size of the image.
	SizeOriginal ImageSize = "original"
)

// ParseImageSize returns the ImageSize of s. An empty s gives SizePreview;
// an unknown value gives an apperr validation error.
func ParseImageSize(s string) (ImageSize, error) {
	switch ImageSize(s) {
	case "", SizePreview:
		return SizePreview, nil
	case SizeOriginal:
		return SizeOriginal, nil
	}
	return "", apperr.Validation("size must be %q or %q", SizePreview, SizeOriginal)
}

// ImportResult is the result of an import or upload.
type ImportResult struct {
	// Photos are the newly imported photos, id ascending.
	Photos []Photo
	// Skipped is the number of requested assets that were already in the
	// collage (same connector and asset ID; for uploads: same file content).
	Skipped int
	// PreviewFallbacks is the number of imported photos that were requested
	// in SizeOriginal, but that the source could only deliver as preview.
	PreviewFallbacks int
}

// Service contains the business rules for photos. Every method takes the id
// of the logged-in user; photos of collages of other users give
// apperr.ErrNotFound.
type Service struct {
	store    Store
	files    FileStorage
	collages Collages
	sources  Sources
	// decoder limits the uploads that are decoded and processed at the
	// same time (server-wide, shared with other packages).
	decoder *imaging.DecodeLimiter
}

// NewService returns a photo service. decoder is the server-wide limiter
// for image decodes.
func NewService(store Store, files FileStorage, collages Collages, sources Sources, decoder *imaging.DecodeLimiter) *Service {
	return &Service{
		store:    store,
		files:    files,
		collages: collages,
		sources:  sources,
		decoder:  decoder,
	}
}

// Import copies the images of the given assets of a connector into the
// collage, in the given size (see ParseImageSize). Originals are converted
// to a JPEG without scaling (see processOriginal); previews and preview
// fallbacks are stored as they are (see readPreview). Assets that are
// already in the collage are skipped; duplicate IDs in assetIDs are
// imported once. Up to importWorkers downloads run in parallel.
//
// If an asset fails, no further downloads are started and the error names
// the asset; downloads that are already running are finished. Photos that
// were imported before the error stay in the collage (a repeated request
// skips them).
func (s *Service) Import(ctx context.Context, userID, collageID, connectorID uint, assetIDs []string, size ImageSize) (ImportResult, error) {
	if _, err := s.collages.Get(ctx, userID, collageID); err != nil {
		return ImportResult{}, err
	}
	if connectorID == 0 {
		return ImportResult{}, apperr.Validation("connectorId is required")
	}
	if size != SizePreview && size != SizeOriginal {
		return ImportResult{}, apperr.Validation("size must be %q or %q", SizePreview, SizeOriginal)
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

	photos, fallbacks, err := s.importAll(ctx, src, collageID, connectorID, todo, size)
	slices.SortFunc(photos, func(a, b Photo) int { return cmp.Compare(a.ID, b.ID) })
	return ImportResult{Photos: photos, Skipped: len(existing), PreviewFallbacks: fallbacks}, err
}

// importAll imports the assets with importWorkers parallel workers. It
// returns the imported photos, the number of preview fallbacks among them
// and the first error.
func (s *Service) importAll(ctx context.Context, src Source, collageID, connectorID uint, assetIDs []string, size ImageSize) ([]Photo, int, error) {
	var (
		mu        sync.Mutex
		photos    = make([]Photo, 0, len(assetIDs))
		fallbacks int
		firstErr  error
		wg        sync.WaitGroup
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
				p, fallback, err := s.importOne(ctx, src, collageID, connectorID, assetID, size)
				if err != nil {
					fail(assetError(assetID, err))
					continue
				}
				mu.Lock()
				photos = append(photos, p)
				if fallback {
					fallbacks++
				}
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
	return photos, fallbacks, firstErr
}

// importOne downloads and checks the image of one asset in the given size,
// then creates the photo row and file together. fallback is true if the
// source delivered the preview instead of the original.
func (s *Service) importOne(ctx context.Context, src Source, collageID, connectorID uint, assetID string, size ImageSize) (p Photo, fallback bool, err error) {
	img, fallback, err := s.download(ctx, src, assetID, size)
	if err != nil {
		return Photo{}, false, err
	}
	p, err = s.createPhoto(ctx, collageID, &connectorID, assetID, img)
	return p, fallback, err
}

// createPhoto creates the photo row and its file together. connectorID is
// nil for uploads. If a step fails, neither the row nor the file is left.
func (s *Service) createPhoto(ctx context.Context, collageID uint, connectorID *uint, sourceAssetID string, img preview) (Photo, error) {
	p := Photo{
		CollageID:     collageID,
		ConnectorID:   connectorID,
		SourceAssetID: sourceAssetID,
		MimeType:      img.mimeType,
		WidthPx:       img.width,
		HeightPx:      img.height,
		Props:         jsoncol.JSON("{}"),
	}
	written := false
	err := s.store.CreateWithFile(ctx, &p, func(p *Photo) error {
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

// Upload stores an image file uploaded by the user in the collage. The
// Content-Type must be image/jpeg, image/png or image/webp. The image is
// converted to a JPEG (see processUpload). A file with the same content
// (SHA-256) that was uploaded to the collage before is skipped
// (ImportResult.Skipped = 1).
//
// A body larger than MaxUploadBytes gives an error that matches
// apperr.ErrTooLarge; bad image data gives an apperr validation error.
func (s *Service) Upload(ctx context.Context, userID, collageID uint, contentType string, body io.Reader) (ImportResult, error) {
	if _, err := s.collages.Get(ctx, userID, collageID); err != nil {
		return ImportResult{}, err
	}
	format, err := imaging.Format(contentType)
	if err != nil {
		return ImportResult{}, err
	}
	data, err := readUpload(body)
	if err != nil {
		return ImportResult{}, err
	}
	assetID := uploadAssetID(data)
	exists, err := s.store.UploadExists(ctx, collageID, assetID)
	if err != nil {
		return ImportResult{}, err
	}
	if exists {
		return ImportResult{Skipped: 1}, nil
	}
	img, err := s.processUpload(ctx, data, format)
	if err != nil {
		return ImportResult{}, err
	}
	p, err := s.createPhoto(ctx, collageID, nil, assetID, img)
	if err != nil {
		return ImportResult{}, fmt.Errorf("store upload in collage %d: %w", collageID, err)
	}
	return ImportResult{Photos: []Photo{p}}, nil
}

// readUpload reads an uploaded file of at most MaxUploadBytes.
func readUpload(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, MaxUploadBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read upload: %w", err)
	}
	if len(data) > MaxUploadBytes {
		return nil, fmt.Errorf("upload is larger than %d MiB: %w", MaxUploadBytes>>20, apperr.ErrTooLarge)
	}
	if len(data) == 0 {
		return nil, apperr.Validation("the uploaded file is empty")
	}
	return data, nil
}

// uploadAssetID returns the source asset ID of an uploaded file:
// "sha256:<hex of the SHA-256 of the original bytes>".
func uploadAssetID(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// download fetches the image of an asset in the given size. An original is
// converted with processOriginal; a preview or a preview fallback is
// checked with readPreview. fallback is true if the source delivered the
// preview instead of the original.
func (s *Service) download(ctx context.Context, src Source, assetID string, size ImageSize) (img preview, fallback bool, err error) {
	res, err := src.Image(ctx, assetID, size)
	if err != nil {
		return preview{}, false, err
	}
	defer res.Body.Close()
	if size == SizeOriginal && !res.Fallback {
		img, err = s.processOriginal(ctx, res.Body, res.ContentType)
		return img, false, err
	}
	img, err = readPreview(res.Body, res.ContentType)
	return img, res.Fallback, err
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
