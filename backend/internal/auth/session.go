package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"gorm.io/gorm"
)

// CookieOptions configures the session cookie.
type CookieOptions struct {
	// Name is the cookie name (must be a valid cookie token).
	Name string
	// Secure sets the Secure flag (send only over HTTPS).
	Secure bool
}

const (
	// sessionLifetime is the lifetime of a session after login or extension.
	sessionLifetime = 30 * 24 * time.Hour
	// extendBelow: a session with less time left is extended (sliding expiry).
	extendBelow = 15 * 24 * time.Hour
	tokenBytes  = 32
)

// newToken returns a random token (base64url, for the cookie) and its hash
// (hex SHA-256, for the DB).
func newToken() (raw, hash string, err error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate session token: %w", err)
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, hashToken(raw), nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// createSession stores a new session for userID and sets the cookie.
func (h *Handler) createSession(w http.ResponseWriter, userID uint) error {
	raw, hash, err := newToken()
	if err != nil {
		return err
	}
	sess := Session{TokenHash: hash, UserID: userID, ExpiresAt: time.Now().UTC().Add(sessionLifetime)}
	if err := h.db.Create(&sess).Error; err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	h.setCookie(w, raw, sess.ExpiresAt)
	return nil
}

// lookupSession returns the raw token and the valid session (with its user)
// of the request cookie. It returns a nil session if there is no cookie or
// the session is unknown or expired. Expired sessions are deleted.
func (h *Handler) lookupSession(r *http.Request) (string, *Session, error) {
	c, err := r.Cookie(h.cookie.Name)
	if err != nil || c.Value == "" {
		return "", nil, nil
	}
	raw := c.Value

	var sess Session
	err = h.db.Preload("User").Where("token_hash = ?", hashToken(raw)).First(&sess).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return raw, nil, nil
	}
	if err != nil {
		return raw, nil, fmt.Errorf("load session: %w", err)
	}

	if !time.Now().Before(sess.ExpiresAt) {
		if err := h.db.Delete(&sess).Error; err != nil {
			return raw, nil, fmt.Errorf("delete expired session: %w", err)
		}
		return raw, nil, nil
	}
	return raw, &sess, nil
}

// extendSession moves the expiry to now + 30 days if less than 15 days are
// left, and sets the cookie again.
func (h *Handler) extendSession(w http.ResponseWriter, raw string, sess *Session) error {
	if time.Until(sess.ExpiresAt) >= extendBelow {
		return nil
	}
	expires := time.Now().UTC().Add(sessionLifetime)
	if err := h.db.Model(sess).Update("expires_at", expires).Error; err != nil {
		return fmt.Errorf("extend session: %w", err)
	}
	h.setCookie(w, raw, expires)
	return nil
}

// deleteSessionByToken deletes the session of a raw token (if any).
func (h *Handler) deleteSessionByToken(raw string) error {
	if raw == "" {
		return nil
	}
	return h.db.Where("token_hash = ?", hashToken(raw)).Delete(&Session{}).Error
}

func (h *Handler) setCookie(w http.ResponseWriter, raw string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookie.Name,
		Value:    raw,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   h.cookie.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookie.Name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.cookie.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}
