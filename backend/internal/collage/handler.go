package collage

import (
	"net/http"
	"time"

	"collageomat/internal/auth"
	"collageomat/internal/httpapi"
	"collageomat/internal/jsoncol"
)

// Handler serves the collage API under /api/collages. It implements
// httpapi.Module.
type Handler struct {
	service *Service
}

// NewHandler returns the collage HTTP handler.
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// RegisterRoutes implements httpapi.Module. All routes need a session.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.Handle("GET /api/collages", requireAuth(http.HandlerFunc(h.list)))
	mux.Handle("POST /api/collages", requireAuth(http.HandlerFunc(h.create)))
	mux.Handle("GET /api/collages/{id}", requireAuth(http.HandlerFunc(h.get)))
	mux.Handle("PATCH /api/collages/{id}", requireAuth(http.HandlerFunc(h.rename)))
	mux.Handle("DELETE /api/collages/{id}", requireAuth(http.HandlerFunc(h.delete)))
	mux.Handle("POST /api/collages/{id}/duplicate", requireAuth(http.HandlerFunc(h.duplicate)))
	mux.Handle("PUT /api/collages/{id}/layout", requireAuth(http.HandlerFunc(h.saveLayout)))
}

type createRequest struct {
	Name     string       `json:"name"`
	Settings jsoncol.JSON `json:"settings"`
}

// layoutRequest is the editor layout. Photos and texts must be present
// (may be empty).
type layoutRequest struct {
	Settings jsoncol.JSON       `json:"settings"`
	Photos   []PhotoPropsUpdate `json:"photos"`
	Texts    []TextData         `json:"texts"`
}

type renameRequest struct {
	Name string `json:"name"`
}

// duplicateRequest is the name of the new collage.
type duplicateRequest struct {
	Name string `json:"name"`
}

// summaryResponse is a list entry; POST and PATCH return it too.
type summaryResponse struct {
	ID         uint         `json:"id"`
	Name       string       `json:"name"`
	Settings   jsoncol.JSON `json:"settings"`
	PhotoCount int          `json:"photoCount"`
	// SizeBytes is the sum of the stored photo file sizes.
	SizeBytes int64     `json:"sizeBytes"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// duplicateResponse is the new collage of a duplicate plus the number of
// photos that were not copied (file missing).
type duplicateResponse struct {
	summaryResponse
	SkippedPhotos int `json:"skippedPhotos"`
}

// detailResponse is the full collage for the editor.
type detailResponse struct {
	ID       uint         `json:"id"`
	Name     string       `json:"name"`
	Settings jsoncol.JSON `json:"settings"`
	Photos   []PhotoView  `json:"photos"`
	Texts    []TextData   `json:"texts"`
}

func toSummaryResponse(s Summary) summaryResponse {
	return summaryResponse{
		ID:         s.ID,
		Name:       s.Name,
		Settings:   s.Settings,
		PhotoCount: s.PhotoCount,
		SizeBytes:  s.SizeBytes,
		UpdatedAt:  s.UpdatedAt,
	}
}

func toDetailResponse(d *Detail) detailResponse {
	return detailResponse{
		ID:       d.ID,
		Name:     d.Name,
		Settings: d.Settings,
		Photos:   d.Photos,
		Texts:    d.Texts,
	}
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	summaries, err := h.service.List(r.Context(), auth.UserID(r))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	resp := make([]summaryResponse, len(summaries))
	for i, s := range summaries {
		resp[i] = toSummaryResponse(s)
	}
	httpapi.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	summary, err := h.service.Create(r.Context(), auth.UserID(r), req.Name, req.Settings)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusCreated, toSummaryResponse(*summary))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	d, err := h.service.Detail(r.Context(), auth.UserID(r), id)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toDetailResponse(d))
}

func (h *Handler) rename(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	var req renameRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	summary, err := h.service.Rename(r.Context(), auth.UserID(r), id, req.Name)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toSummaryResponse(*summary))
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	if err := h.service.Delete(r.Context(), auth.UserID(r), id); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) duplicate(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	var req duplicateRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	res, err := h.service.Duplicate(r.Context(), auth.UserID(r), id, req.Name)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusCreated, duplicateResponse{
		summaryResponse: toSummaryResponse(res.Summary),
		SkippedPhotos:   res.SkippedPhotos,
	})
}

func (h *Handler) saveLayout(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	var req layoutRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	if err := h.service.SaveLayout(r.Context(), auth.UserID(r), id, Layout{
		Settings: req.Settings,
		Photos:   req.Photos,
		Texts:    req.Texts,
	}); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
