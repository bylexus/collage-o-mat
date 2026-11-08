package connector

import (
	"encoding/json"
	"net/http"

	"collageomat/internal/auth"
	"collageomat/internal/httpapi"
)

// Handler serves the generic connector API (/api/connectors). It implements
// httpapi.Module.
type Handler struct {
	svc *Service
}

// NewHandler returns the connector handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes implements httpapi.Module. All routes need a session.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.Handle("GET /api/connectors", requireAuth(http.HandlerFunc(h.list)))
	mux.Handle("POST /api/connectors", requireAuth(http.HandlerFunc(h.create)))
	mux.Handle("PUT /api/connectors/{id}", requireAuth(http.HandlerFunc(h.update)))
	mux.Handle("DELETE /api/connectors/{id}", requireAuth(http.HandlerFunc(h.delete)))
	mux.Handle("POST /api/connectors/{id}/test", requireAuth(http.HandlerFunc(h.test)))
}

type createRequest struct {
	Type   string          `json:"type"`
	Name   string          `json:"name"`
	Config json.RawMessage `json:"config"`
}

type updateRequest struct {
	Name   string          `json:"name"`
	Config json.RawMessage `json:"config"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.List(r.Context(), auth.UserID(r))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, list)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	sum, err := h.svc.Create(r.Context(), auth.UserID(r), CreateInput(req))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusCreated, sum)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	var req updateRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	sum, err := h.svc.Update(r.Context(), auth.UserID(r), id, UpdateInput(req))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, sum)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	if err := h.svc.Delete(r.Context(), auth.UserID(r), id); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// test answers 200 also for a failed connection test (ok=false); HTTP errors
// are only for a missing connector or internal failures.
func (h *Handler) test(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	res, err := h.svc.Test(r.Context(), auth.UserID(r), id)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, res)
}
