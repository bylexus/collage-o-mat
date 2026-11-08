// Package apperr defines the domain errors that services return. The HTTP
// layer maps them to status codes (see httpapi.WriteServiceError).
package apperr

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound means the record does not exist or belongs to another user.
	ErrNotFound = errors.New("not found")
	// ErrConflict means the request conflicts with the current state (for
	// example a duplicate). Use Conflict to create one with a client message.
	ErrConflict = errors.New("conflict")
)

// ValidationError means the client sent invalid input. Its message is shown
// to the client.
type ValidationError struct {
	Message string
}

// Error implements the error interface.
func (e *ValidationError) Error() string { return e.Message }

// Validation returns a ValidationError with a formatted message.
func Validation(format string, args ...any) error {
	return &ValidationError{Message: fmt.Sprintf(format, args...)}
}

// AsValidation returns the ValidationError in err's chain, if there is one.
func AsValidation(err error) (*ValidationError, bool) {
	var v *ValidationError
	ok := errors.As(err, &v)
	return v, ok
}

// conflictError carries a client message and matches ErrConflict.
type conflictError struct {
	message string
}

func (e *conflictError) Error() string        { return e.message }
func (e *conflictError) Is(target error) bool { return target == ErrConflict }

// Conflict returns an error with a formatted message for the client that
// matches ErrConflict (errors.Is(err, ErrConflict) is true).
func Conflict(format string, args ...any) error {
	return &conflictError{message: fmt.Sprintf(format, args...)}
}

// AsConflict returns the client message of a conflict error created with
// Conflict. For a plain (possibly wrapped) ErrConflict it returns the
// message of ErrConflict.
func AsConflict(err error) (string, bool) {
	var c *conflictError
	if errors.As(err, &c) {
		return c.message, true
	}
	if errors.Is(err, ErrConflict) {
		return ErrConflict.Error(), true
	}
	return "", false
}

// UpstreamError means that an external service (for example an Immich
// server) failed, could not be reached or rejected the request. Its message
// is shown to the client. It wraps the cause.
type UpstreamError struct {
	err error
}

// Error implements the error interface.
func (e *UpstreamError) Error() string { return e.err.Error() }

// Unwrap returns the cause.
func (e *UpstreamError) Unwrap() error { return e.err }

// Upstream returns an UpstreamError with a formatted message. Like
// fmt.Errorf, the verb %w wraps an error.
func Upstream(format string, args ...any) error {
	return &UpstreamError{err: fmt.Errorf(format, args...)}
}

// AsUpstream returns the outermost UpstreamError in err's chain, if there is
// one.
func AsUpstream(err error) (*UpstreamError, bool) {
	var u *UpstreamError
	ok := errors.As(err, &u)
	return u, ok
}
