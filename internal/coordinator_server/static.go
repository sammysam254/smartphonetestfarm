// Package coordinator_server implements coordinator HTTP, WebSockets, and administrative APIs.
//
// File: static.go
// Optional static hosting for the built frontend (frontend/dist).
//
// When COORDINATOR_STATIC_DIR is configured, the coordinator serves the SPA on
// the same port as the API. This gives the dashboard a single origin (no CORS,
// no mixed http/ws origins) and lets a Cloudflare Tunnel expose the entire
// farm — UI, REST/WS API, and device streams — through one ingress.

package coordinator_server

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// spaHandler serves the built single-page application from a directory.
//
// Files that exist on disk are served as-is (JS/CSS/assets); every other path
// falls back to index.html so client-side routing (/device/<serial>, …) works
// on hard refresh. Paths under /api/ are never treated as SPA routes.
type spaHandler struct {
	dir        string
	fileServer http.Handler
}

func newSPAHandler(dir string) spaHandler {
	return spaHandler{
		dir:        dir,
		fileServer: http.FileServer(http.Dir(dir)),
	}
}

func (h spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}

	clean := path.Clean("/" + r.URL.Path) // forces the path inside "/"
	name := filepath.Join(h.dir, filepath.FromSlash(strings.TrimPrefix(clean, "/")))

	// Defense in depth: the cleaned path can no longer traverse, but verify
	// the final location is still inside the static dir.
	if !withinDir(h.dir, name) {
		http.NotFound(w, r)
		return
	}

	if st, err := os.Stat(name); err == nil && !st.IsDir() {
		h.fileServer.ServeHTTP(w, r)
		return
	}

	// SPA fallback: unknown non-file routes render the app shell.
	index := filepath.Join(h.dir, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.Error(w, "frontend not built (index.html missing in static dir)", http.StatusInternalServerError)
		return
	}
	http.ServeFile(w, r, index)
}

// withinDir reports whether target resolves inside root (both absolute).
func withinDir(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
