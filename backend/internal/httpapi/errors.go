package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"collageomat/internal/apperr"
)

// WriteServiceError maps an error returned by a service to an HTTP error
// response:
//   - apperr.ErrNotFound → 404 "not found"
//   - apperr.Conflict / ErrConflict → 409 with the conflict message
//   - apperr.ValidationError → 400 with the validation message
//   - apperr.TooManyRequests / ErrTooManyRequests → 429 with its message
//   - apperr.ErrTooLarge or an *http.MaxBytesError (a body limited with
//     http.MaxBytesReader was too large) → 413 "request body too large"
//   - apperr.UpstreamError → 502 with its message (an external service such
//     as Immich failed; never 401/403, so that the client does not treat
//     it as a lost session); the error is logged as a warning
//   - anything else → 500 "internal server error"; the real error is logged.
func WriteServiceError(w http.ResponseWriter, err error) {
	if errors.Is(err, apperr.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "not found")
		return
	}
	if msg, ok := apperr.AsConflict(err); ok {
		WriteError(w, http.StatusConflict, msg)
		return
	}
	if v, ok := apperr.AsValidation(err); ok {
		WriteError(w, http.StatusBadRequest, v.Message)
		return
	}
	if msg, ok := apperr.AsTooManyRequests(err); ok {
		WriteError(w, http.StatusTooManyRequests, msg)
		return
	}
	var maxErr *http.MaxBytesError
	if errors.Is(err, apperr.ErrTooLarge) || errors.As(err, &maxErr) {
		WriteError(w, http.StatusRequestEntityTooLarge, "request body too large")
		return
	}
	if u, ok := apperr.AsUpstream(err); ok {
		slog.Warn("upstream error", "err", err)
		WriteError(w, http.StatusBadGateway, u.Error())
		return
	}
	slog.Error("internal error", "err", err)
	WriteError(w, http.StatusInternalServerError, "internal server error")
}

// PathID parses the path parameter name (see http.Request.PathValue) as a
// positive integer ID. It returns an apperr validation error for a missing,
// non-numeric or zero value.
func PathID(r *http.Request, name string) (uint, error) {
	id, err := strconv.ParseUint(r.PathValue(name), 10, strconv.IntSize)
	if err != nil || id == 0 {
		return 0, apperr.Validation("invalid %s", name)
	}
	return uint(id), nil
}
