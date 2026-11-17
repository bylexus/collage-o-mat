package synology

import (
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"collageomat/internal/apperr"
	"collageomat/internal/auth"
	"collageomat/internal/httpapi"
)

// thumbnailCacheControl is the Cache-Control of proxied thumbnails.
const thumbnailCacheControl = "private, max-age=86400"

// rootFolderParam is the folderId path value for the root folder.
const rootFolderParam = "root"

// Handler serves the Synology routes of a connector
// (/api/connectors/{id}/synology/...). It implements httpapi.Module.
type Handler struct {
	svc *Service
}

// NewHandler returns the Synology HTTP handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes implements httpapi.Module. All routes need a session.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.Handle("GET /api/connectors/{id}/synology/albums", requireAuth(http.HandlerFunc(h.albums)))
	mux.Handle("GET /api/connectors/{id}/synology/albums/{albumId}/assets", requireAuth(http.HandlerFunc(h.albumAssets)))
	mux.Handle("GET /api/connectors/{id}/synology/shared-albums", requireAuth(http.HandlerFunc(h.sharedAlbums)))
	mux.Handle("GET /api/connectors/{id}/synology/shared-albums/{albumId}/assets", requireAuth(http.HandlerFunc(h.sharedAlbumAssets)))
	mux.Handle("GET /api/connectors/{id}/synology/folders/{folderId}", requireAuth(http.HandlerFunc(h.folder)))
	mux.Handle("GET /api/connectors/{id}/synology/folders/{folderId}/assets", requireAuth(http.HandlerFunc(h.folderAssets)))
	mux.Handle("GET /api/connectors/{id}/synology/assets/{assetId}/thumbnail", requireAuth(http.HandlerFunc(h.thumbnail)))
}

// All ids are decimal strings (the same JSON type as the Immich ids). The
// asset id of a photo of a shared album is "s:<albumId>:<itemId>".

type albumResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	AssetCount int    `json:"assetCount"`
	// ThumbnailAssetID is always null (the Synology album list has no
	// cover).
	ThumbnailAssetID *string `json:"thumbnailAssetId"`
}

type assetResponse struct {
	ID       string `json:"id"`
	FileName string `json:"fileName"`
	// Width and Height are the displayed size (EXIF orientation applied).
	Width  int `json:"width"`
	Height int `json:"height"`
	// MimeType is derived from the file extension; "" if unknown.
	MimeType string `json:"mimeType"`
	// ThumbnailKey is the value of the query parameter key of the
	// thumbnail route.
	ThumbnailKey string `json:"thumbnailKey"`
}

type assetPageResponse struct {
	Items []assetResponse `json:"items"`
	// NextPage is null on the last page.
	NextPage *int `json:"nextPage"`
}

type folderRefResponse struct {
	ID string `json:"id"`
	// Name is the last path segment ("" for the root folder).
	Name string `json:"name"`
	// Path is the full path, e.g. "/Ordner 1/Sub-Ordner 1" ("/" for the
	// root folder).
	Path string `json:"path"`
}

type folderResponse struct {
	folderRefResponse
	// ParentID is null for the root folder.
	ParentID *string             `json:"parentId"`
	Folders  []folderRefResponse `json:"folders"`
}

func formatID(id int64) string { return strconv.FormatInt(id, 10) }

func toFolderRefResponse(f Folder) folderRefResponse {
	return folderRefResponse{ID: formatID(f.ID), Name: FolderName(f), Path: f.Name}
}

func toFolderResponse(c FolderContent) folderResponse {
	resp := folderResponse{
		folderRefResponse: toFolderRefResponse(c.Folder),
		Folders:           make([]folderRefResponse, len(c.Subfolders)),
	}
	if !c.Folder.IsRoot() {
		parent := formatID(c.Folder.Parent)
		resp.ParentID = &parent
	}
	for i, f := range c.Subfolders {
		resp.Folders[i] = toFolderRefResponse(f)
	}
	return resp
}

// toAssetPageResponse converts a page of items. sharedAlbumID is the id of
// the shared album of the items, 0 for items of the account's own library.
func toAssetPageResponse(p ItemPage, sharedAlbumID int64) assetPageResponse {
	resp := assetPageResponse{Items: make([]assetResponse, len(p.Items))}
	for i, it := range p.Items {
		resp.Items[i] = assetResponse{
			ID:           assetRef{AlbumID: sharedAlbumID, ItemID: it.ID}.String(),
			FileName:     it.Filename,
			Width:        it.Additional.Resolution.Width,
			Height:       it.Additional.Resolution.Height,
			MimeType:     MimeType(it.Filename),
			ThumbnailKey: it.Additional.Thumbnail.CacheKey,
		}
	}
	if p.NextPage > 0 {
		resp.NextPage = &p.NextPage
	}
	return resp
}

func (h *Handler) albums(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	albums, err := h.svc.Albums(r.Context(), auth.UserID(r), connectorID)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	resp := make([]albumResponse, len(albums))
	for i, a := range albums {
		resp[i] = albumResponse{ID: formatID(a.ID), Name: a.Name, AssetCount: a.ItemCount}
	}
	httpapi.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) albumAssets(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	albumID, err := pathInt64(r, "albumId")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	page, err := pageParam(r)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	res, err := h.svc.AlbumItems(r.Context(), auth.UserID(r), connectorID, albumID, page)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toAssetPageResponse(res, 0))
}

func (h *Handler) sharedAlbums(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	albums, err := h.svc.SharedAlbums(r.Context(), auth.UserID(r), connectorID)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	// The passphrase of the albums is not part of the response.
	resp := make([]albumResponse, len(albums))
	for i, a := range albums {
		resp[i] = albumResponse{ID: formatID(a.ID), Name: a.Name, AssetCount: a.ItemCount}
	}
	httpapi.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) sharedAlbumAssets(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	albumID, err := pathInt64(r, "albumId")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	page, err := pageParam(r)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	res, err := h.svc.SharedAlbumItems(r.Context(), auth.UserID(r), connectorID, albumID, page)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toAssetPageResponse(res, albumID))
}

func (h *Handler) folder(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	folderID, err := folderParam(r)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	res, err := h.svc.Folder(r.Context(), auth.UserID(r), connectorID, folderID)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toFolderResponse(res))
}

func (h *Handler) folderAssets(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	folderID, err := folderParam(r)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	page, err := pageParam(r)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	res, err := h.svc.FolderItems(r.Context(), auth.UserID(r), connectorID, folderID, page)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toAssetPageResponse(res, 0))
}

func (h *Handler) thumbnail(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	// assetId is "<itemId>" or "s:<albumId>:<itemId>"; the service parses
	// it.
	body, contentType, err := h.svc.Thumbnail(r.Context(), auth.UserID(r), connectorID, r.PathValue("assetId"), r.URL.Query().Get("key"))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", thumbnailCacheControl)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, body); err != nil {
		// The status is already sent; the client sees a broken image.
		slog.Warn("proxy synology thumbnail", "connector", connectorID, "err", err)
	}
}

// pathInt64 parses a positive decimal Synology id from the path value name.
func pathInt64(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || id <= 0 {
		return 0, apperr.Validation("invalid %s", name)
	}
	return id, nil
}

// folderParam parses the path value folderId: "root" (RootFolderID) or a
// positive number.
func folderParam(r *http.Request) (int64, error) {
	if r.PathValue("folderId") == rootFolderParam {
		return RootFolderID, nil
	}
	return pathInt64(r, "folderId")
}

// pageParam parses the query parameter page (default 1). The service checks
// the range.
func pageParam(r *http.Request) (int, error) {
	s := r.URL.Query().Get("page")
	if s == "" {
		return 1, nil
	}
	page, err := strconv.Atoi(s)
	if err != nil {
		return 0, apperr.Validation("page must be a number")
	}
	return page, nil
}
