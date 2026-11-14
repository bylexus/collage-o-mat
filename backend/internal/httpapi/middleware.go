package httpapi

import (
	"log/slog"
	"mime"
	"net/http"
	"runtime/debug"
	"strings"
	"time"
)

// statusRecorder captures the status code written by a handler.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

// Logging logs one line per request with method, path, status and duration.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start),
		)
	})
}

// Recover turns a panic in a handler into a 500 JSON error response.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.Error("panic in handler", "panic", v, "stack", string(debug.Stack()))
				WriteError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// RequireJSON is the CSRF protection of the API (together with the
// SameSite=Lax session cookie): a cross-site HTML form cannot send
// Content-Type: application/json without a CORS preflight.
//
// Rules for paths under /api/:
//   - POST, PUT, PATCH: Content-Type must be application/json (parameters
//     such as "; charset=utf-8" are allowed), even with an empty body.
//   - DELETE: the header is required only if the request has a body, so the
//     frontend can send DELETE without a body and without the header.
//   - Other methods (GET, HEAD, OPTIONS): not checked.
//
// The only exception is the photo upload, POST /api/collages/<id>/uploads
// (<id> digits only): it may also send image/jpeg, image/png or image/webp.
// These are not CORS-safelisted Content-Types (only
// application/x-www-form-urlencoded, multipart/form-data and text/plain
// are), so a cross-site page also needs a preflight to send them, which
// gives the same protection as application/json.
//
// Violations get 415 with a JSON error.
func RequireJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && needsJSONContentType(r) && !allowedContentType(r) {
			WriteError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func needsJSONContentType(r *http.Request) bool {
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return true
	case http.MethodDelete:
		// ContentLength is -1 for a body of unknown length (chunked).
		return r.ContentLength != 0
	default:
		return false
	}
}

// uploadContentTypes are the Content-Types allowed for the photo upload
// besides application/json (see RequireJSON).
var uploadContentTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

// allowedContentType reports whether the Content-Type of r is accepted by
// RequireJSON: application/json, or an image type on the upload route.
func allowedContentType(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil {
		return false
	}
	if mediaType == "application/json" {
		return true
	}
	return r.Method == http.MethodPost && uploadContentTypes[mediaType] && isUploadPath(r.URL.Path)
}

// isUploadPath reports whether path is /api/collages/<digits>/uploads.
func isUploadPath(path string) bool {
	rest, ok := strings.CutPrefix(path, "/api/collages/")
	if !ok {
		return false
	}
	id, ok := strings.CutSuffix(rest, "/uploads")
	if !ok || id == "" {
		return false
	}
	for _, c := range id {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
