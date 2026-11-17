package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"collageomat/internal/httpapi"
)

const msgInvalidLogin = "invalid username or password"

// Handler serves the auth API and provides the RequireAuth and RequireAdmin
// middleware.
type Handler struct {
	db     *gorm.DB
	cookie CookieOptions
	// dummyHash is compared for unknown usernames so that the response time
	// is similar to a wrong password.
	dummyHash string
	// limiter blocks a (username, client IP) key after too many failed
	// logins.
	limiter *LoginLimiter
	// avatars gives the avatar version of the user DTO.
	avatars AvatarVersions
}

// AvatarVersions is the part of the profile domain that the user DTO needs.
// The profile package implements it (profile.Service), main.go wires it;
// auth does not import profile (dependency inversion).
type AvatarVersions interface {
	// AvatarVersion returns the version of the avatar of the user (unix
	// milliseconds of its last change), or nil if the user has no avatar.
	AvatarVersion(ctx context.Context, userID uint) (*int64, error)
}

// NewHandler returns the auth handler. limiter counts the failed logins; pass
// the same instance to NewPasswordChanger, so that logins and password
// changes share the counter. avatars gives the avatar version of the user
// DTO.
func NewHandler(db *gorm.DB, cookie CookieOptions, limiter *LoginLimiter, avatars AvatarVersions) (*Handler, error) {
	dummy, err := HashPassword(rand.Text())
	if err != nil {
		return nil, err
	}
	return &Handler{db: db, cookie: cookie, dummyHash: dummy, limiter: limiter, avatars: avatars}, nil
}

// RegisterRoutes implements httpapi.Module.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.HandleFunc("POST /api/auth/login", h.login)
	// Logout is public: it always clears the cookie and answers 204, also
	// with a missing, unknown or expired session.
	mux.HandleFunc("POST /api/auth/logout", h.logout)
	mux.Handle("GET /api/auth/me", requireAuth(http.HandlerFunc(h.me)))
}

// RequireAuth loads the user and the session ID of the session cookie into
// the request context (see UserFromContext, SessionID) and extends the session if needed. Without a valid
// session, or if the user is inactive, it answers 401.
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
		if last := sess.User.LastActiveAt; last == nil || time.Since(*last) >= activityInterval {
			now := time.Now().UTC()
			if err := h.touchActivity(sess.User.ID, now); err != nil {
				// Only the activity date is not up to date; log and continue.
				slog.Warn("session activity", "err", err)
			} else {
				sess.User.LastActiveAt = &now
			}
		}
		ctx := withSessionID(withUser(r.Context(), &sess.User), sess.ID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin answers 403 if the user of the request is not an admin. Use
// it behind RequireAuth: requireAuth(h.RequireAdmin(next)).
func (h *Handler) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := UserFromContext(r.Context())
		if user == nil {
			httpapi.WriteError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !user.IsAdmin {
			httpapi.WriteError(w, http.StatusForbidden, "forbidden")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// UserResponse is the user DTO of the login and me responses (and of the
// profile avatar responses).
type UserResponse struct {
	ID        uint      `json:"id"`
	Username  string    `json:"username"`
	IsAdmin   bool      `json:"isAdmin"`
	CreatedAt time.Time `json:"createdAt"`
	// AvatarVersion is the unix milliseconds of the last avatar change, or
	// null if the user has no avatar.
	AvatarVersion *int64 `json:"avatarVersion"`
}

// NewUserResponse returns the user DTO of u; avatars gives the avatar
// version.
func NewUserResponse(ctx context.Context, u *User, avatars AvatarVersions) (UserResponse, error) {
	version, err := avatars.AvatarVersion(ctx, u.ID)
	if err != nil {
		return UserResponse{}, fmt.Errorf("avatar version of user %d: %w", u.ID, err)
	}
	return UserResponse{
		ID:            u.ID,
		Username:      u.Username,
		IsAdmin:       u.IsAdmin,
		CreatedAt:     u.CreatedAt,
		AvatarVersion: version,
	}, nil
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !httpapi.DecodeJSON(w, r, &req) {
		return
	}

	// Reject oversized input before the limiter, the DB and bcrypt; no
	// limiter entry is stored for it.
	if loginInputTooLong(req.Username, req.Password) {
		httpapi.WriteError(w, http.StatusUnauthorized, msgInvalidLogin)
		return
	}
	username := strings.TrimSpace(req.Username)

	key := LoginKey(username, ClientIP(r))
	if remaining, blocked := h.limiter.Blocked(key); blocked {
		httpapi.WriteError(w, http.StatusTooManyRequests, blockedLoginMessage(remaining))
		return
	}

	var user User
	err := h.db.Where("username = ?", username).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		checkPassword(h.dummyHash, req.Password)
		h.limiter.Fail(key)
		httpapi.WriteError(w, http.StatusUnauthorized, msgInvalidLogin)
		return
	}
	if err != nil {
		slog.Error("login: load user", "err", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	// An inactive user gets the same answer as a wrong password (no account
	// enumeration); the password is checked first, so the timing is the
	// same.
	if !checkPassword(user.PasswordHash, req.Password) || !user.IsActive {
		h.limiter.Fail(key)
		httpapi.WriteError(w, http.StatusUnauthorized, msgInvalidLogin)
		return
	}

	// Housekeeping: drop the session of an old cookie and all expired
	// sessions (of all users). Errors here do not block the login.
	if c, err := r.Cookie(h.cookie.Name); err == nil {
		if err := h.deleteSessionByToken(c.Value); err != nil {
			slog.Warn("login: delete old session", "err", err)
		}
	}
	if err := h.db.Where("expires_at <= ?", time.Now().UTC()).Delete(&Session{}).Error; err != nil {
		slog.Warn("login: delete expired sessions", "err", err)
	}

	if err := h.createSession(w, user.ID); err != nil {
		slog.Error("login: create session", "err", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	// A login is activity. An error here does not block the login.
	now := time.Now().UTC()
	if err := h.touchActivity(user.ID, now); err != nil {
		slog.Warn("login: update last activity", "err", err)
	}
	user.LastActiveAt = &now
	h.limiter.Reset(key)
	resp, err := NewUserResponse(r.Context(), &user, h.avatars)
	if err != nil {
		// The session cookie is set; the client can load the user with /me.
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, resp)
}

// blockedLoginMessage is the 429 text; the remaining time is rounded up to
// whole minutes, at least 1.
func blockedLoginMessage(remaining time.Duration) string {
	minutes := max(int((remaining+time.Minute-1)/time.Minute), 1)
	return fmt.Sprintf("Too many failed logins. Try again in %d minutes.", minutes)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(h.cookie.Name); err == nil {
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
	resp, err := NewUserResponse(r.Context(), UserFromContext(r.Context()), h.avatars)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, resp)
}
