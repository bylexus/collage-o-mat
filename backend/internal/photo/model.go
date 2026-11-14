// Package photo contains the photos of collages: the Photo model, the photo
// files on disk, the import from a photo source (e.g. Immich), the upload of
// local image files and the photo file and delete API.
package photo

import (
	"time"

	"collageomat/internal/collage"
	"collageomat/internal/connector"
	"collageomat/internal/jsoncol"
)

// Photo is one image of a collage: a copy of the source's preview image
// (JPEG or WebP) stored under the photo directory, plus the layout props of
// the editor (one JSON document owned by the frontend; {} after import).
//
// The unique index on (collage_id, connector_id, source_asset_id) makes sure
// an asset is in a collage only once (the import skips duplicates; the index
// also protects against two parallel imports). Rows with a NULL connector_id
// (upload, or connector deleted) do not conflict; the upload service checks
// duplicates itself.
type Photo struct {
	ID        uint            `gorm:"primaryKey"`
	CollageID uint            `gorm:"not null;uniqueIndex:idx_photos_source,priority:1"`
	Collage   collage.Collage `gorm:"constraint:OnDelete:CASCADE"`
	// ConnectorID is the connector the photo was imported from; nil for an
	// upload and after the connector was deleted.
	ConnectorID *uint                `gorm:"uniqueIndex:idx_photos_source,priority:2"`
	Connector   *connector.Connector `gorm:"constraint:OnDelete:SET NULL"`
	// SourceAssetID is the asset ID in the source (e.g. the Immich asset ID);
	// for an upload "sha256:<hex of the SHA-256 of the uploaded bytes>".
	SourceAssetID string `gorm:"size:200;not null;uniqueIndex:idx_photos_source,priority:3"`
	// FileName is the path of the file relative to the photo directory,
	// e.g. "12/345.jpg".
	FileName  string       `gorm:"size:255;not null"`
	MimeType  string       `gorm:"size:50;not null"`
	WidthPx   int          `gorm:"not null"`
	HeightPx  int          `gorm:"not null"`
	Props     jsoncol.JSON `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// TableName sets the table name.
func (Photo) TableName() string { return "photos" }

// View returns the photo as the API shows it.
func (p *Photo) View() collage.PhotoView {
	return collage.PhotoView{
		ID:            p.ID,
		ConnectorID:   p.ConnectorID,
		SourceAssetID: p.SourceAssetID,
		WidthPx:       p.WidthPx,
		HeightPx:      p.HeightPx,
		MimeType:      p.MimeType,
		Props:         p.Props,
	}
}

// views returns the API views of photos, never nil.
func views(photos []Photo) []collage.PhotoView {
	out := make([]collage.PhotoView, len(photos))
	for i := range photos {
		out[i] = photos[i].View()
	}
	return out
}
