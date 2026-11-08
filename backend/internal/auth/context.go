package auth

import "context"

type userContextKey struct{}

func withUser(ctx context.Context, user *User) context.Context {
	return context.WithValue(ctx, userContextKey{}, user)
}

// UserFromContext returns the logged-in user set by RequireAuth, or nil.
func UserFromContext(ctx context.Context) *User {
	u, _ := ctx.Value(userContextKey{}).(*User)
	return u
}
