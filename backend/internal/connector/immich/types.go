package immich

import (
	"fmt"
	"time"
)

// ServerVersion is the response of GET /api/server/version.
type ServerVersion struct {
	Major int `json:"major"`
	Minor int `json:"minor"`
	Patch int `json:"patch"`
}

// String returns the version as "major.minor.patch", e.g. "3.3.6".
func (v ServerVersion) String() string {
	return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
}

// Album is an Immich album (subset of AlbumResponseDto). Since Immich v3
// the album response has no asset list; use Client.AlbumAssets.
type Album struct {
	ID         string `json:"id"`
	AlbumName  string `json:"albumName"`
	AssetCount int    `json:"assetCount"`
	// AlbumThumbnailAssetID is empty if the album has no thumbnail.
	AlbumThumbnailAssetID string     `json:"albumThumbnailAssetId"`
	StartDate             *time.Time `json:"startDate"`
	EndDate               *time.Time `json:"endDate"`
	Shared                bool       `json:"shared"`
}

// AssetType is the type of an Immich asset.
type AssetType string

// Asset types.
const (
	AssetTypeImage AssetType = "IMAGE"
	AssetTypeVideo AssetType = "VIDEO"
)

// Asset is an Immich asset (subset of AssetResponseDto).
type Asset struct {
	ID               string    `json:"id"`
	Type             AssetType `json:"type"`
	OriginalFileName string    `json:"originalFileName"`
	OriginalMimeType string    `json:"originalMimeType"`
	// Width and Height are the original pixel size; 0 if Immich does not
	// know it.
	Width  int `json:"width"`
	Height int `json:"height"`
	// Thumbhash is a small placeholder image (base64), empty if unknown.
	Thumbhash string `json:"thumbhash"`
}

// AssetPage is one page of the images of an album.
type AssetPage struct {
	// Items contains only images (videos are removed).
	Items []Asset
	// NextPage is the number of the next page, 0 if this is the last page.
	NextPage int
}

// ThumbnailSize selects the image size of Client.Thumbnail.
type ThumbnailSize string

// Thumbnail sizes used by Collage-o-mat (Immich defaults: thumbnail 250 px,
// preview 1440 px; JPEG or WebP depending on the server config).
const (
	ThumbnailSizeThumbnail ThumbnailSize = "thumbnail"
	ThumbnailSizePreview   ThumbnailSize = "preview"
)
