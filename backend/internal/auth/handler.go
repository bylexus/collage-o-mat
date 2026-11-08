package auth

import (
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"collageomat/internal/httpapi"
)

const msgInvalidLogin = "invalid username or password"

// Handler serves the auth API and provides the RequireAuth middleware.
type Handler struct {
	db           *gorm.DB
	cookieSecure bool
	// dummyHash is compared for unknown usernames so that the response time
	// is similar to a wrong password.
	dummyHash string
}

// NewHandler returns the auth handler.
func NewHandler(db *gorm.DB, cookieSecure bool) (*Handler, error) {
	dummy, err := hashPassword(rand.Text())
	if err != nil {
		return nil, err
	}
	return &Handler{db: db, cookieSecure: cookieSecure, dummyHash: dummy}, nil
}

// RegisterRoutes implements httpapi.Module.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.HandleFunc("POST /api/auth/login", h.login)
	// Logout is public: it always clears the cookie and answers 204, also
	// with a missing, unknown or expired session.
	mux.HandleFunc("POST /api/auth/logout", h.logout)
	mux.Handle("GET /api/auth/me", requireAuth(http.HandlerFunc(h.me)))
}

// RequireAuth loads the user of the session cookie into the request context
// (see UserFromContext) and extends the session if needed. Without a valid
// session it answers 401.
func (h *Handler) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, sess, err := h.lookupSession(r)
		if err != nil {
			slog.Error("session lookup", "err", err)
			httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if sess == nil {
			if raw != "" {
				h.clearCookie(w)
			}
			httpapi.WriteError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if err := h.extendSession(w, raw, sess); err != nil {
			// The session is still valid; log and continue.
			slog.Error("session extend", "err", err)
		}
		next.ServeHTTP(w, r.WithContext(withUser(r.Context(), &sess.User)))
	})
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type userResponse struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"isAdmin"`
}

func toUserResponse(u *User) userResponse {
	return userResponse{ID: u.ID, Username: u.Username, IsAdmin: u.IsAdmin}
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}

	var user User
	err := h.db.Where("username = ?", strings.TrimSpace(req.Username)).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		checkPassword(h.dummyHash, req.Password)
		httpapi.WriteError(w, http.StatusUnauthorized, msgInvalidLogin)
		return
	}
	if err != nil {
		slog.Error("login: load user", "err", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if !checkPassword(user.PasswordHash, req.Password) {
		httpapi.WriteError(w, http.StatusUnauthorized, msgInvalidLogin)
		return
	}

	// Housekeeping: drop the session of an old cookie and expired sessions
	// of this user. Errors here do not block the login.
	if c, err := r.Cookie(CookieName); err == nil {
		if err := h.deleteSessionByToken(c.Value); err != nil {
			slog.Warn("login: delete old session", "err", err)
		}
	}
	if err := h.db.Where("user_id = ? AND expires_at <= ?", user.ID, time.Now().UTC()).Delete(&Session{}).Error; err != nil {
		slog.Warn("login: delete expired sessions", "err", err)
	}

	if err := h.createSession(w, user.ID); err != nil {
		slog.Error("login: create session", "err", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toUserResponse(&user))
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(CookieName); err == nil {
		if err := h.deleteSessionByToken(c.Value); err != nil {
			slog.Error("logout: delete session", "err", err)
			httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	}
	h.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	httpapi.WriteJSON(w, http.StatusOK, toUserResponse(UserFromContext(r.Context())))
}
