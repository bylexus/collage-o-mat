package collage

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"collageomat/internal/apperr"
	"collageomat/internal/jsoncol"
)

// MaxNameLength is the maximum length of a collage name in characters.
const MaxNameLength = 200

// MaxTextIDLength is the maximum length of a text id in bytes (the frontend
// sends UUIDs).
const MaxTextIDLength = 64

// Store is the persistence the service needs (implemented by GormStore).
type Store interface {
	ListByUser(ctx context.Context, userID uint) ([]Collage, error)
	// OwnerByCollage returns the user id of every collage (collage id ->
	// user id).
	OwnerByCollage(ctx context.Context) (map[uint]uint, error)
	// FindForUser returns apperr.ErrNotFound if the collage does not exist
	// or belongs to another user.
	FindForUser(ctx context.Context, userID, id uint) (*Collage, error)
	Create(ctx context.Context, c *Collage) error
	UpdateName(ctx context.Context, c *Collage, name string) error
	// UpdateSettingsForUser sets the settings and UpdatedAt. It returns
	// apperr.ErrNotFound if the collage does not exist or belongs to another
	// user.
	UpdateSettingsForUser(ctx context.Context, userID, id uint, settings jsoncol.JSON) error
	Delete(ctx context.Context, id uint) error
	// ListTexts returns the texts of a collage, never nil.
	ListTexts(ctx context.Context, collageID uint) ([]CollageText, error)
	// TextIDsInOtherCollages returns those of ids that belong to another
	// collage than collageID.
	TextIDsInOtherCollages(ctx context.Context, collageID uint, ids []string) ([]string, error)
	// ReplaceTexts makes texts the complete text list of the collage
	// (create, replace props, delete the texts that are not listed).
	ReplaceTexts(ctx context.Context, collageID uint, texts []CollageText) error
}

// Photos is the part of the photo domain that the collage service needs.
// The photo package implements it (photo.CollagePhotos); the collage package
// does not import the photo package (dependency inversion).
type Photos interface {
	// StatsByCollages returns the number and the size of the photos per
	// collage id. Collages without photos may be missing in the map (zero
	// value).
	StatsByCollages(ctx context.Context, collageIDs []uint) (map[uint]PhotoStats, error)
	// SizeByCollage returns the sum of the photo sizes of a collage in
	// bytes.
	SizeByCollage(ctx context.Context, collageID uint) (int64, error)
	// CountAllByCollage returns the number of photos per collage id of all
	// collages (all users). Collages without photos may be missing.
	CountAllByCollage(ctx context.Context) (map[uint]int, error)
	// ListForCollage returns the photos of a collage in import order (id
	// ascending), never nil.
	ListForCollage(ctx context.Context, collageID uint) ([]PhotoView, error)
	// DeleteAllForCollage deletes all photos of a collage (rows and files).
	// It is called before the collage row is deleted and must be idempotent,
	// so that a failed collage delete can be retried.
	DeleteAllForCollage(ctx context.Context, collageID uint) error
	// UpdateProps sets the props of the listed photos of a collage. It
	// returns an apperr validation error ("unknown photo id N") if a listed
	// photo is not in the collage.
	UpdateProps(ctx context.Context, collageID uint, updates []PhotoPropsUpdate) error
	// CopyAllForCollage copies all photos of srcCollageID (rows with their
	// props, and their files) into dstCollageID. It returns the map old photo
	// id -> new photo id and the number of photos that were skipped because
	// their source file does not exist. Each copy is checked against the
	// storage limit of userID (limit in bytes, 0 = unlimited); a copy that
	// does not fit gives an apperr conflict. Every error stops the copy;
	// files that were already written stay on disk (remove them with
	// DeleteAllForCollage of dstCollageID).
	CopyAllForCollage(
		ctx context.Context, srcCollageID, dstCollageID, userID uint, limit int64,
	) (idMap map[uint]uint, skipped int, err error)
}

// Quotas gives the storage usage and limit of a user (implemented by
// *quota.Service).
type Quotas interface {
	// Usage returns the used photo bytes and the effective storage limit of
	// the user in bytes (0 = unlimited).
	Usage(ctx context.Context, userID uint) (used, limit int64, err error)
}

// Transactor runs fn in one database transaction: all store and Photos
// calls with the context passed to fn are part of it (implemented by
// db.Transactor). If fn returns an error, nothing is changed.
type Transactor interface {
	InTx(ctx context.Context, fn func(ctx context.Context) error) error
}

// PhotoPropsUpdate is the new props document of one photo (layout save).
type PhotoPropsUpdate struct {
	ID    uint         `json:"id"`
	Props jsoncol.JSON `json:"props"`
}

// PhotoView is a photo of a collage as the API shows it (collage detail and
// import result). The image URL is derived by the client:
// /api/collages/{collageId}/photos/{id}/file.
type PhotoView struct {
	ID uint `json:"id"`
	// ConnectorID is nil if the connector was deleted after the import.
	ConnectorID   *uint        `json:"connectorId"`
	SourceAssetID string       `json:"sourceAssetId"`
	WidthPx       int          `json:"widthPx"`
	HeightPx      int          `json:"heightPx"`
	MimeType      string       `json:"mimeType"`
	Props         jsoncol.JSON `json:"props"`
}

// TextData is one text of a collage as the API shows it (collage detail)
// and saves it (layout save).
type TextData struct {
	ID    string       `json:"id"`
	Props jsoncol.JSON `json:"props"`
}

// Layout is the editor state that a layout save replaces: the settings, the
// props of the listed photos and the complete text list. Photos and Texts
// must not be nil (empty lists are allowed).
type Layout struct {
	Settings jsoncol.JSON
	Photos   []PhotoPropsUpdate
	Texts    []TextData
}

// PhotoStats is the number of photos of a collage and the sum of their
// sizes in bytes.
type PhotoStats struct {
	Count     int
	SizeBytes int64
}

// Summary is a collage with the number and the stored size of its photos
// (list entry).
type Summary struct {
	Collage
	PhotoCount int
	SizeBytes  int64
}

// Detail is a collage with its photos and texts (editor view).
type Detail struct {
	Collage
	Photos []PhotoView
	Texts  []TextData
}

// Service contains the business rules for collages. Every method takes the
// id of the logged-in user; collages of other users give apperr.ErrNotFound.
type Service struct {
	store  Store
	photos Photos
	quotas Quotas
	tx     Transactor
}

// NewService returns a collage service. quotas gives the storage limit for
// Duplicate.
func NewService(store Store, photos Photos, quotas Quotas, tx Transactor) *Service {
	return &Service{store: store, photos: photos, quotas: quotas, tx: tx}
}

// List returns the collages of the user with photo counts and sizes, most
// recently updated first.
func (s *Service) List(ctx context.Context, userID uint) ([]Summary, error) {
	collages, err := s.store.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	ids := make([]uint, len(collages))
	for i, c := range collages {
		ids[i] = c.ID
	}
	stats, err := s.photos.StatsByCollages(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("count photos of collages: %w", err)
	}
	summaries := make([]Summary, len(collages))
	for i, c := range collages {
		summaries[i] = summary(c, stats[c.ID])
	}
	return summaries, nil
}

// Create validates name and settings and creates a new collage without
// photos.
func (s *Service) Create(ctx context.Context, userID uint, name string, settings jsoncol.JSON) (*Summary, error) {
	name, err := validName(name)
	if err != nil {
		return nil, err
	}
	if !settings.IsObject() {
		return nil, apperr.Validation("settings must be a JSON object")
	}
	c := Collage{UserID: userID, Name: name, Settings: settings}
	if err := s.store.Create(ctx, &c); err != nil {
		return nil, err
	}
	return &Summary{Collage: c}, nil
}

// Get returns one collage of the user (without photos). Other domains use
// it to check that a collage belongs to the user.
func (s *Service) Get(ctx context.Context, userID, id uint) (*Collage, error) {
	return s.store.FindForUser(ctx, userID, id)
}

// Detail returns one collage of the user with its photos and texts.
func (s *Service) Detail(ctx context.Context, userID, id uint) (*Detail, error) {
	c, err := s.store.FindForUser(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	photos, err := s.photos.ListForCollage(ctx, c.ID)
	if err != nil {
		return nil, fmt.Errorf("list photos of collage %d: %w", c.ID, err)
	}
	texts, err := s.store.ListTexts(ctx, c.ID)
	if err != nil {
		return nil, err
	}
	return &Detail{Collage: *c, Photos: photos, Texts: textData(texts)}, nil
}

// Rename validates name and sets it as the new name of the collage.
func (s *Service) Rename(ctx context.Context, userID, id uint, name string) (*Summary, error) {
	name, err := validName(name)
	if err != nil {
		return nil, err
	}
	c, err := s.store.FindForUser(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if err := s.store.UpdateName(ctx, c, name); err != nil {
		return nil, err
	}
	stats, err := s.photos.StatsByCollages(ctx, []uint{c.ID})
	if err != nil {
		return nil, fmt.Errorf("count photos of collage %d: %w", c.ID, err)
	}
	sum := summary(*c, stats[c.ID])
	return &sum, nil
}

// summary returns the list entry of collage c with the photo stats st.
func summary(c Collage, st PhotoStats) Summary {
	return Summary{Collage: c, PhotoCount: st.Count, SizeBytes: st.SizeBytes}
}

// Delete deletes the collage with all its photos and texts (the texts by
// the foreign key ON DELETE CASCADE).
func (s *Service) Delete(ctx context.Context, userID, id uint) error {
	c, err := s.store.FindForUser(ctx, userID, id)
	if err != nil {
		return err
	}
	if err := s.photos.DeleteAllForCollage(ctx, c.ID); err != nil {
		return fmt.Errorf("delete photos of collage %d: %w", c.ID, err)
	}
	return s.store.Delete(ctx, c.ID)
}

// SaveLayout saves the layout in one transaction; the collage's UpdatedAt
// changes. It replaces the settings and the props of the listed photos
// (photos that are not listed keep their props) and makes layout.Texts the
// complete text list of the collage (new texts are created, listed texts get
// the new props, texts that are not listed are deleted).
//
// Settings and each props must be JSON objects ({} is an unplaced photo); a
// photo id may be listed only once and must belong to the collage. A text id
// must be 1–MaxTextIDLength bytes, may be listed only once and must not
// belong to another collage.
func (s *Service) SaveLayout(ctx context.Context, userID, id uint, layout Layout) error {
	if err := validLayout(layout); err != nil {
		return err
	}
	return s.tx.InTx(ctx, func(ctx context.Context) error {
		// The write comes first: it checks ownership and makes this a write
		// transaction from the start (no read-to-write lock upgrade in
		// SQLite).
		if err := s.store.UpdateSettingsForUser(ctx, userID, id, layout.Settings); err != nil {
			return err
		}
		if err := s.photos.UpdateProps(ctx, id, layout.Photos); err != nil {
			return fmt.Errorf("update photo props of collage %d: %w", id, err)
		}
		return s.replaceTexts(ctx, id, layout.Texts)
	})
}

// replaceTexts makes texts the text list of the collage. A text id of
// another collage gives a validation error.
func (s *Service) replaceTexts(ctx context.Context, collageID uint, texts []TextData) error {
	ids := make([]string, len(texts))
	rows := make([]CollageText, len(texts))
	for i, t := range texts {
		ids[i] = t.ID
		rows[i] = CollageText{ID: t.ID, CollageID: collageID, Props: t.Props}
	}
	foreign, err := s.store.TextIDsInOtherCollages(ctx, collageID, ids)
	if err != nil {
		return err
	}
	if len(foreign) > 0 {
		return apperr.Validation("text id %q belongs to another collage", foreign[0])
	}
	return s.store.ReplaceTexts(ctx, collageID, rows)
}

// validLayout checks the input of SaveLayout that does not need the
// database.
func validLayout(layout Layout) error {
	if !layout.Settings.IsObject() {
		return apperr.Validation("settings must be a JSON object")
	}
	if err := validPhotoUpdates(layout.Photos); err != nil {
		return err
	}
	return validTexts(layout.Texts)
}

// validPhotoUpdates checks the photo list of a layout save.
func validPhotoUpdates(photos []PhotoPropsUpdate) error {
	if photos == nil {
		return apperr.Validation("photos must be a list")
	}
	seen := make(map[uint]bool, len(photos))
	for _, p := range photos {
		if seen[p.ID] {
			return apperr.Validation("duplicate photo id %d", p.ID)
		}
		seen[p.ID] = true
		if !p.Props.IsObject() {
			return apperr.Validation("props of photo %d must be a JSON object", p.ID)
		}
	}
	return nil
}

// validTexts checks the text list of a layout save.
func validTexts(texts []TextData) error {
	if texts == nil {
		return apperr.Validation("texts must be a list")
	}
	seen := make(map[string]bool, len(texts))
	for _, t := range texts {
		if t.ID == "" {
			return apperr.Validation("text id is required")
		}
		if len(t.ID) > MaxTextIDLength {
			return apperr.Validation("text id must be at most %d characters", MaxTextIDLength)
		}
		if seen[t.ID] {
			return apperr.Validation("duplicate text id %q", t.ID)
		}
		seen[t.ID] = true
		if !t.Props.IsObject() {
			return apperr.Validation("props of text %q must be a JSON object", t.ID)
		}
	}
	return nil
}

// textData returns the API views of texts, never nil.
func textData(texts []CollageText) []TextData {
	out := make([]TextData, len(texts))
	for i, t := range texts {
		out[i] = TextData{ID: t.ID, Props: t.Props}
	}
	return out
}

// validName returns the trimmed name or a validation error if it is empty
// or too long.
func validName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", apperr.Validation("name is required")
	}
	if utf8.RuneCountInString(name) > MaxNameLength {
		return "", apperr.Validation("name must be at most %d characters", MaxNameLength)
	}
	return name, nil
}
