package auth

import (
	"context"
	"net/http"
)

type userContextKey struct{}

type sessionIDContextKey struct{}

func withUser(ctx context.Context, user *User) context.Context {
	return context.WithValue(ctx, userContextKey{}, user)
}

// UserFromContext returns the logged-in user set by RequireAuth, or nil.
func UserFromContext(ctx context.Context) *User {
	u, _ := ctx.Value(userContextKey{}).(*User)
	return u
}

// UserID returns the ID of the logged-in user. It is only valid in handlers
// behind RequireAuth, which always puts the user into the request context.
func UserID(r *http.Request) uint {
	return UserFromContext(r.Context()).ID
}

func withSessionID(ctx context.Context, sessionID uint) context.Context {
	return context.WithValue(ctx, sessionIDContextKey{}, sessionID)
}

// SessionID returns the ID of the current session. It is only valid in
// handlers behind RequireAuth, which always puts the session ID into the
// request context.
func SessionID(r *http.Request) uint {
	id, _ := r.Context().Value(sessionIDContextKey{}).(uint)
	return id
}
