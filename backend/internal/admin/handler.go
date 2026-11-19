package admin

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"collageomat/internal/auth"
	"collageomat/internal/httpapi"
)

// Handler serves the user management API under /api/admin/users. It
// implements httpapi.Module.
type Handler struct {
	service      *Service
	requireAdmin httpapi.Middleware
}

// NewHandler returns the admin HTTP handler. requireAdmin is the admin check
// (auth.Handler.RequireAdmin); it runs behind requireAuth.
func NewHandler(service *Service, requireAdmin httpapi.Middleware) *Handler {
	return &Handler{service: service, requireAdmin: requireAdmin}
}

// RegisterRoutes implements httpapi.Module. All routes need a session of an
// admin.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	admin := func(fn http.HandlerFunc) http.Handler { return requireAuth(h.requireAdmin(fn)) }
	mux.Handle("GET /api/admin/users", admin(h.list))
	mux.Handle("POST /api/admin/users", admin(h.create))
	mux.Handle("PATCH /api/admin/users/{id}", admin(h.update))
	mux.Handle("DELETE /api/admin/users/{id}", admin(h.delete))
	mux.Handle("GET /api/admin/users/{id}/avatar", admin(h.avatar))
}

// avatarCacheControl lets the browser keep the avatar: the frontend adds
// the avatar version (?v=) to the URL (same as the profile avatar).
const avatarCacheControl = "private, max-age=31536000, immutable"

// createRequest is the create dialog. A missing or null maxStorageBytes
// gives the user the server default limit.
type createRequest struct {
	Username        string `json:"username"`
	Password        string `json:"password"`
	IsAdmin         bool   `json:"isAdmin"`
	MaxStorageBytes *int64 `json:"maxStorageBytes"`
}

// updateRequest is the edit dialog. isAdmin, isActive and maxStorageBytes
// are required (maxStorageBytes null = server default); an empty or
// missing newPassword keeps the password.
type updateRequest struct {
	IsAdmin         *bool         `json:"isAdmin"`
	IsActive        *bool         `json:"isActive"`
	MaxStorageBytes nullableInt64 `json:"maxStorageBytes"`
	NewPassword     string        `json:"newPassword"`
}

// nullableInt64 is a JSON number field that tells a missing field (Set
// false) from null (Set true, Value nil).
type nullableInt64 struct {
	Set   bool
	Value *int64
}

// UnmarshalJSON implements json.Unmarshaler. It is called only for a
// present field, also for null.
func (n *nullableInt64) UnmarshalJSON(b []byte) error {
	n.Set = true
	n.Value = nil
	return json.Unmarshal(b, &n.Value)
}

// userResponse is a user of the admin user list; create and update return
// it too.
type userResponse struct {
	ID        uint      `json:"id"`
	Username  string    `json:"username"`
	IsAdmin   bool      `json:"isAdmin"`
	IsActive  bool      `json:"isActive"`
	CreatedAt time.Time `json:"createdAt"`
	// AvatarVersion is the unix milliseconds of the last avatar change, or
	// null if the user has no avatar.
	AvatarVersion *int64 `json:"avatarVersion"`
	// LastActiveAt is the time of the last login or authenticated request
	// (precision: 1 hour), or null if no activity is recorded.
	LastActiveAt *time.Time `json:"lastActiveAt"`
	CollageCount int        `json:"collageCount"`
	PhotoCount   int        `json:"photoCount"`
	// UsedStorageBytes is the sum of the photo sizes of the user.
	UsedStorageBytes int64 `json:"usedStorageBytes"`
	// MaxStorageBytes is the own storage limit (0 = unlimited), or null if
	// the user has the server default.
	MaxStorageBytes *int64 `json:"maxStorageBytes"`
	// EffectiveMaxStorageBytes is the own limit or the server default;
	// 0 = unlimited.
	EffectiveMaxStorageBytes int64 `json:"effectiveMaxStorageBytes"`
}

func newUserResponse(u *UserSummary) userResponse {
	return userResponse{
		ID:            u.ID,
		Username:      u.Username,
		IsAdmin:       u.IsAdmin,
		IsActive:      u.IsActive,
		CreatedAt:     u.CreatedAt,
		AvatarVersion: u.AvatarVersion,
		LastActiveAt:  u.LastActiveAt,
		CollageCount:  u.CollageCount,
		PhotoCount:    u.PhotoCount,

		UsedStorageBytes:         u.UsedStorageBytes,
		MaxStorageBytes:          u.MaxStorageBytes,
		EffectiveMaxStorageBytes: u.EffectiveMaxStorageBytes,
	}
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	users, err := h.service.ListUsers(r.Context())
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	out := make([]userResponse, len(users))
	for i := range users {
		out[i] = newUserResponse(&users[i])
	}
	httpapi.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}
	u, err := h.service.CreateUser(r.Context(), req.Username, req.Password, req.IsAdmin, req.MaxStorageBytes)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusCreated, newUserResponse(u))
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
	if req.IsAdmin == nil || req.IsActive == nil || !req.MaxStorageBytes.Set {
		httpapi.WriteError(w, http.StatusBadRequest, "isAdmin, isActive and maxStorageBytes are required")
		return
	}
	u, err := h.service.UpdateUser(r.Context(), auth.UserID(r), id, Update{
		IsAdmin:         *req.IsAdmin,
		IsActive:        *req.IsActive,
		MaxStorageBytes: req.MaxStorageBytes.Value,
		NewPassword:     req.NewPassword,
	})
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, newUserResponse(u))
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	if err := h.service.DeleteUser(r.Context(), auth.UserID(r), id); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// avatar serves the avatar image of the user id, 404 if none is set.
// http.ServeContent handles HEAD, Range and If-Modified-Since requests.
func (h *Handler) avatar(w http.ResponseWriter, r *http.Request) {
	id, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	a, err := h.service.Avatar(r.Context(), id)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", a.MimeType)
	w.Header().Set("Cache-Control", avatarCacheControl)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", a.UpdatedAt, bytes.NewReader(a.Data))
}
