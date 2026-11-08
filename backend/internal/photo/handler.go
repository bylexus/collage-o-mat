package photo

import (
	"net/http"

	"collageomat/internal/auth"
	"collageomat/internal/collage"
	"collageomat/internal/httpapi"
)

// fileCacheControl is the Cache-Control of photo files. A photo file never
// changes (a new import is a new photo id), so it can be cached forever.
const fileCacheControl = "private, max-age=31536000, immutable"

// Handler serves the photo API under /api/collages/{id}/... It implements
// httpapi.Module.
type Handler struct {
	svc *Service
}

// NewHandler returns the photo HTTP handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes implements httpapi.Module. All routes need a session.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.Handle("POST /api/collages/{id}/import", requireAuth(http.HandlerFunc(h.importAssets)))
	mux.Handle("DELETE /api/collages/{id}/photos/{photoId}", requireAuth(http.HandlerFunc(h.delete)))
	mux.Handle("GET /api/collages/{id}/photos/{photoId}/file", requireAuth(http.HandlerFunc(h.file)))
}

type importRequest struct {
	ConnectorID uint     `json:"connectorId"`
	AssetIDs    []string `json:"assetIds"`
}

type importResponse struct {
	Photos  []collage.PhotoView `json:"photos"`
	Skipped int                 `json:"skipped"`
}

func (h *Handler) importAssets(w http.ResponseWriter, r *http.Request) {
	collageID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	var req importRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	res, err := h.svc.Import(r.Context(), auth.UserID(r), collageID, req.ConnectorID, req.AssetIDs)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, importResponse{Photos: views(res.Photos), Skipped: res.Skipped})
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	collageID, photoID, err := pathIDs(r)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	if err := h.svc.Delete(r.Context(), auth.UserID(r), collageID, photoID); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// file serves the image bytes. http.ServeContent handles HEAD, Range and
// If-Modified-Since requests.
func (h *Handler) file(w http.ResponseWriter, r *http.Request) {
	collageID, photoID, err := pathIDs(r)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	p, f, err := h.svc.OpenFile(r.Context(), auth.UserID(r), collageID, photoID)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", p.MimeType)
	w.Header().Set("Cache-Control", fileCacheControl)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", p.CreatedAt, f)
}

// pathIDs parses the path parameters id (collage) and photoId.
func pathIDs(r *http.Request) (collageID, photoID uint, err error) {
	if collageID, err = httpapi.PathID(r, "id"); err != nil {
		return 0, 0, err
	}
	if photoID, err = httpapi.PathID(r, "photoId"); err != nil {
		return 0, 0, err
	}
	return collageID, photoID, nil
}
