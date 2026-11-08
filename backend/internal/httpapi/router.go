// Package httpapi contains the HTTP router, JSON helpers and middleware.
package httpapi

import (
	"net/http"
)

// Middleware wraps a handler.
type Middleware func(http.Handler) http.Handler

// Module is a part of the API that registers its own routes (auth, later
// collages, connectors, ...). httpapi does not import the domain packages;
// main.go passes the modules to NewRouter.
type Module interface {
	// RegisterRoutes adds the module's routes to mux. Routes that need a
	// logged-in user wrap their handler with requireAuth.
	RegisterRoutes(mux *http.ServeMux, requireAuth Middleware)
}

// NewRouter returns the root handler: JSON API under /api/, everything else
// goes to the static (SPA) handler. All /api routes except GET /api/health
// and the public routes of the modules need a session (requireAuth).
func NewRouter(static http.Handler, requireAuth Middleware, modules ...Module) http.Handler {
	mux := http.NewServeMux()

	health := &healthHandler{}
	mux.HandleFunc("GET /api/health", health.get)

	for _, m := range modules {
		m.RegisterRoutes(mux, requireAuth)
	}

	// Unknown API paths always get a JSON 404, never the SPA.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, http.StatusNotFound, "not found")
	})

	mux.Handle("/", static)

	return Logging(Recover(RequireJSON(mux)))
}

type healthHandler struct{}

func (h *healthHandler) get(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
