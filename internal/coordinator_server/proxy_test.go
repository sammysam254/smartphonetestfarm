// Package coordinator_server implements coordinator HTTP, WebSockets, and administrative APIs.
//
// File: proxy_test.go
// Verifies that the stream-proxy routes coexist with the pre-existing device
// action subtree: Go 1.22+ ServeMux pattern precedence must send
// /api/v1/devices/{serial}/{ws,stream,state,upload} to the proxy while
// claim/release/control keep hitting handleDeviceAction — and that neither
// registration panics.

package coordinator_server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// buildRoutingMux reproduces the route table assembled by Server.Start with
// stub handlers so routing can be asserted without a database.
func buildRoutingMux(t *testing.T) (*http.ServeMux, *string) {
	t.Helper()

	mux := http.NewServeMux()
	hit := ""

	mux.HandleFunc("/api/v1/devices", func(w http.ResponseWriter, r *http.Request) {
		hit = "list"
	})
	mux.HandleFunc("/api/v1/devices/ws", func(w http.ResponseWriter, r *http.Request) {
		hit = "device-ws"
	})
	mux.HandleFunc("/api/v1/devices/", func(w http.ResponseWriter, r *http.Request) {
		hit = "action:" + r.URL.Path
	})

	// Stand-in for Server.registerStreamProxyRoutes: identical patterns, but a
	// stub handler that records the resolved PathValue instead of hitting the DB.
	for _, sub := range streamProxySubpaths {
		mux.HandleFunc("/api/v1/devices/"+subPathPattern(sub), func(w http.ResponseWriter, r *http.Request) {
			hit = "proxy:" + r.PathValue("serial") + "/" + streamSubpathFromPath(r.URL.Path)
		})
	}

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		hit = "healthz"
	})
	mux.Handle("/", newSPAHandler(t.TempDir()))

	return mux, &hit
}

func TestStreamProxyRouting(t *testing.T) {
	mux, hitPtr := buildRoutingMux(t)

	tests := []struct {
		path string
		want string
	}{
		// New proxy endpoints resolve {serial} and the subpath.
		{"/api/v1/devices/ABC123/ws", "proxy:ABC123/ws"},
		{"/api/v1/devices/ABC123/stream", "proxy:ABC123/stream"},
		{"/api/v1/devices/ABC123/state", "proxy:ABC123/state"},
		{"/api/v1/devices/ABC123/upload", "proxy:ABC123/upload"},
		// Serials with colons (adb over TCP) must stay a single segment.
		{"/api/v1/devices/192.168.1.5:5555/ws", "proxy:192.168.1.5:5555/ws"},
		// Existing endpoints keep their handlers.
		{"/api/v1/devices/ABC123/claim", "action:/api/v1/devices/ABC123/claim"},
		{"/api/v1/devices/ABC123/release", "action:/api/v1/devices/ABC123/release"},
		{"/api/v1/devices/ABC123/control", "action:/api/v1/devices/ABC123/control"},
		{"/api/v1/devices", "list"},
		{"/api/v1/devices/ws", "device-ws"},
		{"/healthz", "healthz"},
	}

	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))

			// The SPA handler can't render a real index.html from the empty temp
			// dir — treat its 500 as "routed to SPA", everything else must be 200.
			if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
				t.Fatalf("unexpected status %d for %s", rec.Code, tc.path)
			}
			if got := *hitPtr; got != tc.want {
				t.Fatalf("route %s dispatched to %q, want %q", tc.path, got, tc.want)
			}
		})
	}
}

func TestStreamSubpathFromPath(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"/api/v1/devices/ABC123/ws", "ws"},
		{"/api/v1/devices/ABC123/upload", "upload"},
		{"/api/v1/devices/with:colon/state", "state"},
		{"/api/v1/devices/ABC123/ws/", "ws"}, // trailing slash tolerated
		{"/api/v1/devices/ws", ""},           // not a device subpath (device-ws handler)
		{"", ""},
	}
	for _, tc := range tests {
		if got := streamSubpathFromPath(tc.path); got != tc.want {
			t.Errorf("streamSubpathFromPath(%q) = %q, want %q", tc.path, got, tc.want)
		}
	}
}
