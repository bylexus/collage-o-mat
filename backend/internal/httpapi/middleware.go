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
// Violations get 415 with a JSON error.
func RequireJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && needsJSONContentType(r) && !isJSONContentType(r) {
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

func isJSONContentType(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mediaType == "application/json"
}
