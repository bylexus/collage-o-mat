package synology

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"path"
	"slices"
	"strconv"
	"strings"

	"collageomat/internal/apperr"
	"collageomat/internal/connector"
	"collageomat/internal/photo"
)

const (
	// listPageSize is the limit of one album or folder list request; the
	// service loads all pages.
	listPageSize = 500
	// maxListPages stops the loading of album or folder pages (protection
	// against a NAS that ignores the offset).
	maxListPages = 100
	// itemPageSize is the number of items per page for the frontend. The
	// service requests one more item to know whether a next page exists.
	itemPageSize = 250
	// maxItemPage limits the page number (the offset must not overflow).
	maxItemPage = 1_000_000
	// gridThumbnailSize is the thumbnail size of the import grid (short
	// side 320 px).
	gridThumbnailSize = "m"
	// maxCacheKeyLength limits the thumbnail cache key from the client.
	maxCacheKeyLength = 100
	// previewThumbnailSize is the thumbnail size of a preview import and of
	// the fallback of an original import (short side 1280 px, no
	// upscaling).
	previewThumbnailSize = "xl"
)

// Item filter parameters of SYNO.Foto.Browse.Item list.
const (
	filterAlbum      = "album_id"
	filterFolder     = "folder_id"
	filterPassphrase = "passphrase"
)

// sharedAssetPrefix starts the asset id of a photo of a shared album:
// "s:<albumId>:<itemId>".
const sharedAssetPrefix = "s:"

// RootFolderID is the folder id for the root folder of the Personal Space
// (0 is no valid Synology folder id).
const RootFolderID int64 = 0

// Connectors loads connectors of a user (implemented by
// *connector.Service).
type Connectors interface {
	// LoadConfig returns apperr.ErrNotFound if the connector does not exist
	// or belongs to another user.
	LoadConfig(ctx context.Context, userID, id uint) (connector.Connector, json.RawMessage, error)
}

// Service contains the Synology-specific use cases of a connector: browse
// the albums and folders of the Personal Space, proxy thumbnails, and
// download images for the photo import (it implements photo.Sources). All
// NAS failures are returned as apperr upstream errors (HTTP 502).
type Service struct {
	connectors Connectors
	kind       *Kind
}

var _ photo.Sources = (*Service)(nil)

// NewService returns the Synology service. kind creates the clients and
// keeps their sessions.
func NewService(connectors Connectors, kind *Kind) *Service {
	return &Service{connectors: connectors, kind: kind}
}

// Albums returns all albums of the account, sorted by name
// (case-insensitive). Conditional albums are included like normal albums.
func (s *Service) Albums(ctx context.Context, userID, connectorID uint) ([]Album, error) {
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	albums, err := listAll(ctx, client.listAlbums)
	if err != nil {
		return nil, upstream(err)
	}
	slices.SortFunc(albums, func(a, b Album) int {
		return cmp.Or(
			cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)),
			cmp.Compare(a.ID, b.ID),
		)
	})
	return albums, nil
}

// AlbumItems returns one page (1-based) of the photos of an album.
func (s *Service) AlbumItems(ctx context.Context, userID, connectorID uint, albumID int64, page int) (ItemPage, error) {
	if err := checkPage(page); err != nil {
		return ItemPage{}, err
	}
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return ItemPage{}, err
	}
	return itemPage(ctx, client, filterAlbum, formatID(albumID), page)
}

// SharedAlbums returns all albums that other users shared with the account,
// sorted by name (case-insensitive). Albums without id or passphrase are
// left out (they cannot be opened). The list also refreshes the passphrase
// cache of the connector.
func (s *Service) SharedAlbums(ctx context.Context, userID, connectorID uint) ([]SharedAlbum, error) {
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	albums, err := loadSharedAlbums(ctx, client)
	if err != nil {
		return nil, err
	}
	albums = slices.DeleteFunc(albums, func(a SharedAlbum) bool { return a.ID <= 0 || a.Passphrase == "" })
	slices.SortFunc(albums, func(a, b SharedAlbum) int {
		return cmp.Or(
			cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)),
			cmp.Compare(a.ID, b.ID),
		)
	})
	return albums, nil
}

// SharedAlbumItems returns one page (1-based) of the photos of an album
// shared with the account. An album that is not (or no longer) shared with
// the account gives apperr.ErrNotFound.
func (s *Service) SharedAlbumItems(ctx context.Context, userID, connectorID uint, albumID int64, page int) (ItemPage, error) {
	if err := checkPage(page); err != nil {
		return ItemPage{}, err
	}
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return ItemPage{}, err
	}
	passphrase, err := sharedPassphrase(ctx, client, albumID)
	if err != nil {
		return ItemPage{}, err
	}
	return itemPage(ctx, client, filterPassphrase, passphrase, page)
}

// Folder returns the folder folderID (RootFolderID for the root folder)
// with its direct subfolders, sorted by name (case-insensitive).
func (s *Service) Folder(ctx context.Context, userID, connectorID uint, folderID int64) (FolderContent, error) {
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return FolderContent{}, err
	}
	folder, err := client.getFolder(ctx, folderID)
	if err != nil {
		return FolderContent{}, upstream(err)
	}
	// The children of the root are listed without id (verified on the
	// NAS); other folders with their id.
	listID := folder.ID
	if folderID == RootFolderID {
		listID = RootFolderID
	}
	subfolders, err := listAll(ctx, func(ctx context.Context, offset, limit int) ([]Folder, error) {
		return client.listFolders(ctx, listID, offset, limit)
	})
	if err != nil {
		return FolderContent{}, upstream(err)
	}
	slices.SortFunc(subfolders, func(a, b Folder) int {
		return cmp.Or(
			cmp.Compare(strings.ToLower(FolderName(a)), strings.ToLower(FolderName(b))),
			cmp.Compare(a.ID, b.ID),
		)
	})
	return FolderContent{Folder: folder, Subfolders: subfolders}, nil
}

// FolderItems returns one page (1-based) of the direct photos of the folder
// folderID (RootFolderID for the root folder).
func (s *Service) FolderItems(ctx context.Context, userID, connectorID uint, folderID int64, page int) (ItemPage, error) {
	if err := checkPage(page); err != nil {
		return ItemPage{}, err
	}
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return ItemPage{}, err
	}
	if folderID == RootFolderID {
		root, err := client.getFolder(ctx, RootFolderID)
		if err != nil {
			return ItemPage{}, upstream(err)
		}
		folderID = root.ID
	}
	return itemPage(ctx, client, filterFolder, formatID(folderID), page)
}

// Thumbnail returns the grid thumbnail (size "m") of an item and its
// Content-Type. The caller must close the reader. assetID is an asset id
// of the import (see parseAssetRef). cacheKey is the item's thumbnail cache
// key (Item thumbnail cache_key). A response that is not an image is
// rejected (an error of the NAS is JSON, also with HTTP 200), so that the
// proxy never serves other content from the app's origin.
func (s *Service) Thumbnail(ctx context.Context, userID, connectorID uint, assetID, cacheKey string) (io.ReadCloser, string, error) {
	ref, err := parseAssetRef(assetID)
	if err != nil {
		return nil, "", err
	}
	if !validCacheKey(cacheKey) {
		return nil, "", apperr.Validation("invalid thumbnail key")
	}
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return nil, "", err
	}
	passphrase, err := ref.passphrase(ctx, client)
	if err != nil {
		return nil, "", err
	}
	body, contentType, err := client.thumbnail(ctx, ref.ItemID, cacheKey, gridThumbnailSize, passphrase)
	if err != nil {
		return nil, "", upstream(err)
	}
	if mediaType, _, _ := mime.ParseMediaType(contentType); !strings.HasPrefix(mediaType, "image/") {
		body.Close()
		return nil, "", apperr.Upstream("the NAS returned no image for item %d (Content-Type %q)", ref.ItemID, contentType)
	}
	return body, contentType, nil
}

// Source implements photo.Sources: the preview and original images of the
// connector's NAS.
func (s *Service) Source(ctx context.Context, userID, connectorID uint) (photo.Source, error) {
	client, err := s.client(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	return imageSource{client: client}, nil
}

// client returns a Synology client for a connector of the user. A connector
// of another type gives a validation error.
func (s *Service) client(ctx context.Context, userID, connectorID uint) (*Client, error) {
	c, config, err := s.connectors.LoadConfig(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	if c.Type != Type {
		return nil, apperr.Validation("connector %d is not a Synology connector", connectorID)
	}
	return s.kind.Client(connectorID, config)
}

// imageSource implements photo.Source: photo.SizePreview is the "xl"
// thumbnail, photo.SizeOriginal the original file (with the "xl" thumbnail
// as fallback for formats the import cannot decode and for originals of
// shared albums that the NAS refuses).
type imageSource struct {
	client *Client
}

// originalTypes are the Content-Types of originals that the photo import
// can decode (see imaging). Other originals (HEIC, RAW, a ZIP of a Live
// Photo, ...) are replaced by the preview.
var originalTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

// Image implements photo.Source. assetID is an asset id of the import (see
// parseAssetRef). If the NAS refuses the original of a photo of a shared
// album with a Synology API error (e.g. the account has only the "viewer"
// role), the "xl" thumbnail is returned with Fallback set.
func (p imageSource) Image(ctx context.Context, assetID string, size photo.ImageSize) (photo.SourceImage, error) {
	ref, err := parseAssetRef(assetID)
	if err != nil {
		return photo.SourceImage{}, err
	}
	passphrase, err := ref.passphrase(ctx, p.client)
	if err != nil {
		return photo.SourceImage{}, err
	}
	if size == photo.SizeOriginal {
		body, contentType, err := p.client.original(ctx, ref.ItemID, passphrase)
		switch {
		case err != nil && (!ref.shared() || !isRefusal(err)):
			return photo.SourceImage{}, upstream(err)
		case err == nil:
			if mediaType, _, _ := mime.ParseMediaType(contentType); originalTypes[mediaType] {
				return photo.SourceImage{Body: body, ContentType: contentType}, nil
			}
			body.Close()
		}
		img, err := p.preview(ctx, ref.ItemID, passphrase)
		img.Fallback = true
		return img, err
	}
	return p.preview(ctx, ref.ItemID, passphrase)
}

// preview returns the "xl" thumbnail of the item id (passphrase is the
// share token for an item of a shared album, "" for an own item). The
// thumbnail API does not check the cache key (verified on the NAS; it only
// busts caches), so a key derived from the id is sent instead of loading
// the item for its real key.
func (p imageSource) preview(ctx context.Context, id int64, passphrase string) (photo.SourceImage, error) {
	body, contentType, err := p.client.thumbnail(ctx, id, strconv.FormatInt(id, 10)+"_0", previewThumbnailSize, passphrase)
	if err != nil {
		return photo.SourceImage{}, upstream(err)
	}
	return photo.SourceImage{Body: body, ContentType: contentType}, nil
}

// isRefusal reports whether err is a Synology API error that refuses a
// request (e.g. no permission). Session and login errors and transport or
// HTTP status errors are no refusal.
func isRefusal(err error) bool {
	var ae *APIError
	return errors.As(err, &ae) && !ae.Login && !isSessionError(err)
}

// assetRef is a parsed asset id of the import.
type assetRef struct {
	// AlbumID is the id of the shared album of the photo, 0 for a photo of
	// the account's own library.
	AlbumID int64
	// ItemID is the Synology item id.
	ItemID int64
}

// shared reports whether the asset is a photo of a shared album.
func (r assetRef) shared() bool { return r.AlbumID != 0 }

// String returns the asset id: "<itemId>" for an own photo,
// "s:<albumId>:<itemId>" for a photo of a shared album.
func (r assetRef) String() string {
	if r.shared() {
		return sharedAssetPrefix + formatID(r.AlbumID) + ":" + formatID(r.ItemID)
	}
	return formatID(r.ItemID)
}

// passphrase returns the share token of the asset's shared album, "" for
// an own photo.
func (r assetRef) passphrase(ctx context.Context, client *Client) (string, error) {
	if !r.shared() {
		return "", nil
	}
	return sharedPassphrase(ctx, client, r.AlbumID)
}

// parseAssetRef parses an asset id of the import: "<itemId>" for a photo of
// the account's own library or "s:<albumId>:<itemId>" for a photo of a
// shared album. Ids are positive decimals in canonical form (no sign, no
// leading zeros), so that the same photo always has the same source asset
// id.
func parseAssetRef(assetID string) (assetRef, error) {
	invalid := apperr.Validation("invalid Synology asset id %q", assetID)
	rest, shared := strings.CutPrefix(assetID, sharedAssetPrefix)
	if !shared {
		id, ok := parseCanonicalID(assetID)
		if !ok {
			return assetRef{}, invalid
		}
		return assetRef{ItemID: id}, nil
	}
	albumPart, itemPart, found := strings.Cut(rest, ":")
	if !found {
		return assetRef{}, invalid
	}
	albumID, okAlbum := parseCanonicalID(albumPart)
	itemID, okItem := parseCanonicalID(itemPart)
	if !okAlbum || !okItem {
		return assetRef{}, invalid
	}
	return assetRef{AlbumID: albumID, ItemID: itemID}, nil
}

// parseCanonicalID parses a positive decimal id in canonical form.
func parseCanonicalID(s string) (int64, bool) {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != s {
		return 0, false
	}
	return id, true
}

// loadSharedAlbums loads all albums shared with the account (all pages)
// and refreshes the passphrase cache of the client.
func loadSharedAlbums(ctx context.Context, client *Client) ([]SharedAlbum, error) {
	albums, err := listAll(ctx, client.listSharedAlbums)
	if err != nil {
		return nil, upstream(err)
	}
	client.passphrases.replace(albums)
	return albums, nil
}

// sharedPassphrase returns the share token of the album albumID that is
// shared with the account. If the cache does not know the album, the
// shared-album list is loaded once more. An album that is still unknown
// gives apperr.ErrNotFound.
func sharedPassphrase(ctx context.Context, client *Client, albumID int64) (string, error) {
	if pass, ok := client.passphrases.get(albumID); ok {
		return pass, nil
	}
	if _, err := loadSharedAlbums(ctx, client); err != nil {
		return "", err
	}
	if pass, ok := client.passphrases.get(albumID); ok {
		return pass, nil
	}
	return "", fmt.Errorf("shared Synology album %d: %w", albumID, apperr.ErrNotFound)
}

// itemPage loads one page of the items of an album, a folder or a shared
// album (see Client.listItems for filterParam and filterValue). It requests
// itemPageSize+1 items: the extra item only shows that a next page exists.
// Only photos and Live Photos are returned, so a page can have fewer items
// than itemPageSize even if more pages follow.
func itemPage(ctx context.Context, client *Client, filterParam, filterValue string, page int) (ItemPage, error) {
	items, err := client.listItems(ctx, filterParam, filterValue, (page-1)*itemPageSize, itemPageSize+1)
	if err != nil {
		return ItemPage{}, upstream(err)
	}
	res := ItemPage{Items: make([]Item, 0, min(len(items), itemPageSize))}
	if len(items) > itemPageSize {
		items = items[:itemPageSize]
		res.NextPage = page + 1
	}
	for _, it := range items {
		if it.Type == ItemTypePhoto || it.Type == ItemTypeLive {
			res.Items = append(res.Items, it)
		}
	}
	return res, nil
}

// listAll loads all pages of a list (listPageSize per request) until a page
// is not full.
func listAll[T any](ctx context.Context, fetch func(ctx context.Context, offset, limit int) ([]T, error)) ([]T, error) {
	var all []T
	for range maxListPages {
		list, err := fetch(ctx, len(all), listPageSize)
		if err != nil {
			return nil, err
		}
		all = append(all, list...)
		if len(list) < listPageSize {
			return all, nil
		}
	}
	return nil, fmt.Errorf("the NAS returned more than %d entries", maxListPages*listPageSize)
}

// checkPage checks a 1-based page number.
func checkPage(page int) error {
	if page < 1 {
		return apperr.Validation("page must be a positive number")
	}
	if page > maxItemPage {
		return apperr.Validation("page is too large")
	}
	return nil
}

// validCacheKey reports whether key looks like a thumbnail cache key
// ("<id>_<timestamp>"): not empty, at most maxCacheKeyLength characters,
// only ASCII letters, digits, "_" and "-".
func validCacheKey(key string) bool {
	if key == "" || len(key) > maxCacheKeyLength {
		return false
	}
	for _, r := range key {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

// FolderName returns the last path segment of a folder ("" for the root
// folder "/").
func FolderName(f Folder) string {
	p := strings.TrimRight(f.Name, "/")
	return p[strings.LastIndex(p, "/")+1:]
}

// mimeTypes maps file extensions (lower case) of photos to MIME types.
var mimeTypes = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".gif":  "image/gif",
	".bmp":  "image/bmp",
	".tif":  "image/tiff",
	".tiff": "image/tiff",
	".heic": "image/heic",
	".heif": "image/heif",
	".avif": "image/avif",
}

// MimeType returns the MIME type of a photo from the extension of its file
// name, "" if it is unknown (e.g. RAW formats).
func MimeType(filename string) string {
	return mimeTypes[strings.ToLower(path.Ext(filename))]
}

// upstream marks an error of the Synology client as an upstream error. The
// client's messages are safe to show (they never contain the password or
// the session id).
func upstream(err error) error {
	return apperr.Upstream("%w", err)
}
