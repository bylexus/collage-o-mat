// Package web serves the embedded Angular SPA.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var embedded embed.FS

const indexFile = "index.html"

// Handler serves static files from the embedded SPA build. Paths that are not
// a file get index.html (SPA fallback). Without a frontend build it answers
// with a plain-text 404.
type Handler struct {
	files fs.FS
}

// NewHandler returns a handler for the embedded dist directory.
func NewHandler() (*Handler, error) {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil, err
	}
	return &Handler{files: sub}, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name != "" && h.isFile(name) {
		http.ServeFileFS(w, r, h.files, name)
		return
	}

	// A missing path with a file extension is a missing asset, not a route.
	if name != "" && path.Ext(name) != "" {
		http.NotFound(w, r)
		return
	}

	if !h.isFile(indexFile) {
		http.Error(w, "frontend not built (run 'make build')", http.StatusNotFound)
		return
	}
	http.ServeFileFS(w, r, h.files, indexFile)
}

func (h *Handler) isFile(name string) bool {
	st, err := fs.Stat(h.files, name)
	return err == nil && !st.IsDir()
}
