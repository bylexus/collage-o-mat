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

// Store is the persistence the service needs (implemented by GormStore).
type Store interface {
	ListByUser(ctx context.Context, userID uint) ([]Collage, error)
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
}

// Photos is the part of the photo domain that the collage service needs.
// The photo package implements it (photo.CollagePhotos); the collage package
// does not import the photo package (dependency inversion).
type Photos interface {
	// CountByCollages returns the number of photos per collage id. Collages
	// without photos may be missing in the map (count 0).
	CountByCollages(ctx context.Context, collageIDs []uint) (map[uint]int, error)
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

// Summary is a collage with the number of its photos (list entry).
type Summary struct {
	Collage
	PhotoCount int
}

// Detail is a collage with its photos (editor view).
type Detail struct {
	Collage
	Photos []PhotoView
}

// Service contains the business rules for collages. Every method takes the
// id of the logged-in user; collages of other users give apperr.ErrNotFound.
type Service struct {
	store  Store
	photos Photos
	tx     Transactor
}

// NewService returns a collage service.
func NewService(store Store, photos Photos, tx Transactor) *Service {
	return &Service{store: store, photos: photos, tx: tx}
}

// List returns the collages of the user with photo counts, most recently
// updated first.
func (s *Service) List(ctx context.Context, userID uint) ([]Summary, error) {
	collages, err := s.store.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	ids := make([]uint, len(collages))
	for i, c := range collages {
		ids[i] = c.ID
	}
	counts, err := s.photos.CountByCollages(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("count photos of collages: %w", err)
	}
	summaries := make([]Summary, len(collages))
	for i, c := range collages {
		summaries[i] = Summary{Collage: c, PhotoCount: counts[c.ID]}
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

// Detail returns one collage of the user with its photos.
func (s *Service) Detail(ctx context.Context, userID, id uint) (*Detail, error) {
	c, err := s.store.FindForUser(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	photos, err := s.photos.ListForCollage(ctx, c.ID)
	if err != nil {
		return nil, fmt.Errorf("list photos of collage %d: %w", c.ID, err)
	}
	return &Detail{Collage: *c, Photos: photos}, nil
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
	counts, err := s.photos.CountByCollages(ctx, []uint{c.ID})
	if err != nil {
		return nil, fmt.Errorf("count photos of collage %d: %w", c.ID, err)
	}
	return &Summary{Collage: *c, PhotoCount: counts[c.ID]}, nil
}

// Delete deletes the collage with all its photos.
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

// SaveLayout replaces the settings of the collage and the props of the
// listed photos in one transaction; the collage's UpdatedAt changes. Photos
// that are not listed keep their props. photos must not be nil (an empty
// list is allowed). Settings and each props must be JSON objects ({} is an
// unplaced photo); a photo id may be listed only once and must belong to the
// collage.
func (s *Service) SaveLayout(ctx context.Context, userID, id uint, settings jsoncol.JSON, photos []PhotoPropsUpdate) error {
	if err := validLayout(settings, photos); err != nil {
		return err
	}
	return s.tx.InTx(ctx, func(ctx context.Context) error {
		// The write comes first: it checks ownership and makes this a write
		// transaction from the start (no read-to-write lock upgrade in
		// SQLite).
		if err := s.store.UpdateSettingsForUser(ctx, userID, id, settings); err != nil {
			return err
		}
		if err := s.photos.UpdateProps(ctx, id, photos); err != nil {
			return fmt.Errorf("update photo props of collage %d: %w", id, err)
		}
		return nil
	})
}

// validLayout checks the input of SaveLayout that does not need the
// database.
func validLayout(settings jsoncol.JSON, photos []PhotoPropsUpdate) error {
	if !settings.IsObject() {
		return apperr.Validation("settings must be a JSON object")
	}
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
