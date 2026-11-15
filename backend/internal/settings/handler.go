package settings

import (
	"net/http"

	"collageomat/internal/httpapi"
)

// Handler serves the system settings API under /api/admin/settings. It
// implements httpapi.Module.
type Handler struct {
	service      *Service
	requireAdmin httpapi.Middleware
}

// NewHandler returns the settings HTTP handler. requireAdmin is the admin
// check (auth.Handler.RequireAdmin); it runs behind requireAuth.
func NewHandler(service *Service, requireAdmin httpapi.Middleware) *Handler {
	return &Handler{service: service, requireAdmin: requireAdmin}
}

// RegisterRoutes implements httpapi.Module. All routes need a session of an
// admin.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.Handle("GET /api/admin/settings", requireAuth(h.requireAdmin(http.HandlerFunc(h.get))))
	mux.Handle("PUT /api/admin/settings", requireAuth(h.requireAdmin(http.HandlerFunc(h.put))))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	s, err := h.service.Get(r.Context())
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, s)
}

// put replaces the settings with the request body (the full Settings
// object) and answers with the stored settings. A field that is missing in
// the body keeps its current value.
func (h *Handler) put(w http.ResponseWriter, r *http.Request) {
	req, err := h.service.Get(r.Context())
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	s, err := h.service.Update(r.Context(), req)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, s)
}
