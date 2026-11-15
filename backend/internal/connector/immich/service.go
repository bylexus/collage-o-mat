package immich

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"slices"
	"strings"

	"collageomat/internal/apperr"
	"collageomat/internal/connector"
	"collageomat/internal/photo"
)

// Connectors loads connectors of a user (implemented by
// *connector.Service).
type Connectors interface {
	// LoadConfig returns apperr.ErrNotFound if the connector does not exist
	// or belongs to another user.
	LoadConfig(ctx context.Context, userID, id uint) (connector.Connector, json.RawMessage, error)
}

// Service contains the Immich-specific use cases of a connector: browse
// albums and assets, proxy thumbnails, and download previews for the photo
// import (it implements photo.Sources). All Immich failures are returned as
// apperr upstream errors (HTTP 502).
type Service struct {
	connectors Connectors
	kind       *Kind
}

var _ photo.Sources = (*Service)(nil)

// NewService returns the Immich service. kind creates the clients.
func NewService(connectors Connectors, kind *Kind) *Service {
	return &Service{connectors: connectors, kind: kind}
}

// Albums returns the albums of the connector's Immich server, sorted by name
// (case-insensitive).
func (s *Service) Albums(ctx context.Context, userID, connectorID uint) ([]Album, error) {
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	albums, err := client.ListAlbums(ctx)
	if err != nil {
		return nil, upstream(err)
	}
	slices.SortFunc(albums, func(a, b Album) int {
		return cmp.Or(
			cmp.Compare(strings.ToLower(a.AlbumName), strings.ToLower(b.AlbumName)),
			cmp.Compare(a.ID, b.ID),
		)
	})
	return albums, nil
}

// AlbumAssets returns one page (1-based) of the images of an album.
func (s *Service) AlbumAssets(ctx context.Context, userID, connectorID uint, albumID string, page int) (AssetPage, error) {
	if page < 1 {
		return AssetPage{}, apperr.Validation("page must be a positive number")
	}
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return AssetPage{}, err
	}
	res, err := client.AlbumAssets(ctx, albumID, page)
	if err != nil {
		return AssetPage{}, upstream(err)
	}
	return res, nil
}

// Thumbnail returns the small thumbnail of an asset and its Content-Type.
// The caller must close the reader. A response that is not an image is
// rejected, so that the proxy never serves other content (e.g. HTML) from
// the app's origin.
func (s *Service) Thumbnail(ctx context.Context, userID, connectorID uint, assetID string) (io.ReadCloser, string, error) {
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return nil, "", err
	}
	body, contentType, _, err := client.Thumbnail(ctx, assetID, ThumbnailSizeThumbnail)
	if err != nil {
		return nil, "", upstream(err)
	}
	if mediaType, _, _ := mime.ParseMediaType(contentType); !strings.HasPrefix(mediaType, "image/") {
		body.Close()
		return nil, "", apperr.Upstream("Immich returned no image for asset %q (Content-Type %q)", assetID, contentType)
	}
	return body, contentType, nil
}

// Source implements photo.Sources: the preview and original images of the
// connector's Immich server.
func (s *Service) Source(ctx context.Context, userID, connectorID uint) (photo.Source, error) {
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	return imageSource{client: client}, nil
}

// client returns an Immich client for a connector of the user. A connector
// of another type gives a validation error.
func (s *Service) client(ctx context.Context, userID, connectorID uint) (*Client, error) {
	c, config, err := s.connectors.LoadConfig(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	if c.Type != Type {
		return nil, apperr.Validation("connector %d is not an Immich connector", connectorID)
	}
	return s.kind.Client(config)
}

// imageSource implements photo.Source with the Immich sizes preview
// (photo.SizePreview) and fullsize (photo.SizeOriginal).
type imageSource struct {
	client *Client
}

// Image implements photo.Source. A 403 on the original file (the key has
// no permission asset.download) gives a specific upstream error.
func (p imageSource) Image(ctx context.Context, assetID string, size photo.ImageSize) (photo.SourceImage, error) {
	thumbSize := ThumbnailSizePreview
	if size == photo.SizeOriginal {
		thumbSize = ThumbnailSizeFullsize
	}
	body, contentType, fallback, err := p.client.Thumbnail(ctx, assetID, thumbSize)
	if err != nil {
		var se *StatusError
		if errors.As(err, &se) && se.StatusCode == http.StatusForbidden && strings.HasSuffix(se.Path, "/original") {
			return photo.SourceImage{}, apperr.Upstream("Original size needs the permission asset.download on the Immich API key")
		}
		return photo.SourceImage{}, upstream(err)
	}
	return photo.SourceImage{Body: body, ContentType: contentType, Fallback: fallback}, nil
}

// upstream marks an error of the Immich client as an upstream error. The
// client's messages are safe to show (they never contain the API key).
func upstream(err error) error {
	return apperr.Upstream("%w", err)
}
