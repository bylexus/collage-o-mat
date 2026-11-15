package immich

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

// Handler serves the Immich routes of a connector
// (/api/connectors/{id}/immich/...). It implements httpapi.Module.
type Handler struct {
	svc *Service
}

// NewHandler returns the Immich HTTP handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes implements httpapi.Module. All routes need a session.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.Handle("GET /api/connectors/{id}/immich/albums", requireAuth(http.HandlerFunc(h.albums)))
	mux.Handle("GET /api/connectors/{id}/immich/albums/{albumId}/assets", requireAuth(http.HandlerFunc(h.albumAssets)))
	mux.Handle("GET /api/connectors/{id}/immich/assets/{assetId}/thumbnail", requireAuth(http.HandlerFunc(h.thumbnail)))
}

type albumResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	AssetCount int    `json:"assetCount"`
	// ThumbnailAssetID is null if the album has no thumbnail.
	ThumbnailAssetID *string `json:"thumbnailAssetId"`
}

type assetResponse struct {
	ID       string `json:"id"`
	FileName string `json:"fileName"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	// MimeType is the MIME type of the original file (e.g. "image/heic").
	MimeType string `json:"mimeType"`
}

type assetPageResponse struct {
	Items []assetResponse `json:"items"`
	// NextPage is null on the last page.
	NextPage *int `json:"nextPage"`
}

func toAlbumResponse(a Album) albumResponse {
	resp := albumResponse{ID: a.ID, Name: a.AlbumName, AssetCount: a.AssetCount}
	if a.AlbumThumbnailAssetID != "" {
		resp.ThumbnailAssetID = &a.AlbumThumbnailAssetID
	}
	return resp
}

func toAssetPageResponse(p AssetPage) assetPageResponse {
	resp := assetPageResponse{Items: make([]assetResponse, len(p.Items))}
	for i, a := range p.Items {
		resp.Items[i] = assetResponse{
			ID:       a.ID,
			FileName: a.OriginalFileName,
			Width:    a.Width,
			Height:   a.Height,
			MimeType: a.OriginalMimeType,
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
		resp[i] = toAlbumResponse(a)
	}
	httpapi.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) albumAssets(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	page, err := pageParam(r)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	res, err := h.svc.AlbumAssets(r.Context(), auth.UserID(r), connectorID, r.PathValue("albumId"), page)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toAssetPageResponse(res))
}

func (h *Handler) thumbnail(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	body, contentType, err := h.svc.Thumbnail(r.Context(), auth.UserID(r), connectorID, r.PathValue("assetId"))
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
		slog.Warn("proxy immich thumbnail", "connector", connectorID, "err", err)
	}
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
