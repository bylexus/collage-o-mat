package profile

import (
	"bytes"
	"net/http"

	"collageomat/internal/auth"
	"collageomat/internal/httpapi"
)

// Handler serves the profile API under /api/profile. It implements
// httpapi.Module.
type Handler struct {
	service *Service
}

// NewHandler returns the profile HTTP handler.
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// RegisterRoutes implements httpapi.Module. All routes need a session.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.Handle("PUT /api/profile/password", requireAuth(http.HandlerFunc(h.changePassword)))
	mux.Handle("PUT /api/profile/avatar", requireAuth(http.HandlerFunc(h.setAvatar)))
	mux.Handle("DELETE /api/profile/avatar", requireAuth(http.HandlerFunc(h.deleteAvatar)))
	mux.Handle("GET /api/profile/avatar", requireAuth(http.HandlerFunc(h.avatar)))
	mux.Handle("GET /api/profile/storage", requireAuth(http.HandlerFunc(h.storage)))
}

// avatarCacheControl lets the browser keep the avatar: the frontend adds
// the avatar version (?v=) to the URL, so a new avatar has a new URL.
const avatarCacheControl = "private, max-age=31536000, immutable"

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	if err := h.service.ChangePassword(
		r.Context(), auth.UserID(r), auth.SessionID(r), auth.ClientIP(r), req.CurrentPassword, req.NewPassword,
	); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// storageResponse is the photo storage usage of the logged-in user.
type storageResponse struct {
	UsedBytes int64 `json:"usedBytes"`
	// LimitBytes is the effective limit (own or server default);
	// 0 = unlimited.
	LimitBytes int64 `json:"limitBytes"`
}

// storage answers with the storage usage of the logged-in user.
func (h *Handler) storage(w http.ResponseWriter, r *http.Request) {
	used, limit, err := h.service.StorageUsage(r.Context(), auth.UserID(r))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, storageResponse{UsedBytes: used, LimitBytes: limit})
}

// setAvatar sets the avatar of the logged-in user from the raw request body
// (Content-Type image/jpeg, image/png or image/webp). The body is limited to
// MaxAvatarBytes (413 if larger). It answers with the user DTO.
func (h *Handler) setAvatar(w http.ResponseWriter, r *http.Request) {
	body := http.MaxBytesReader(w, r.Body, MaxAvatarBytes)
	if err := h.service.SetAvatar(r.Context(), auth.UserID(r), r.Header.Get("Content-Type"), body); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	h.writeUser(w, r)
}

// deleteAvatar removes the avatar of the logged-in user (also when none is
// set) and answers with the user DTO.
func (h *Handler) deleteAvatar(w http.ResponseWriter, r *http.Request) {
	if err := h.service.DeleteAvatar(r.Context(), auth.UserID(r)); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	h.writeUser(w, r)
}

// avatar serves the avatar image of the logged-in user, 404 if none is set.
// http.ServeContent handles HEAD, Range and If-Modified-Since requests.
func (h *Handler) avatar(w http.ResponseWriter, r *http.Request) {
	a, err := h.service.Avatar(r.Context(), auth.UserID(r))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", a.MimeType)
	w.Header().Set("Cache-Control", avatarCacheControl)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", a.UpdatedAt, bytes.NewReader(a.Data))
}

// writeUser answers 200 with the user DTO of the logged-in user (same shape
// as GET /api/auth/me).
func (h *Handler) writeUser(w http.ResponseWriter, r *http.Request) {
	resp, err := auth.NewUserResponse(r.Context(), auth.UserFromContext(r.Context()), h.service)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, resp)
}
