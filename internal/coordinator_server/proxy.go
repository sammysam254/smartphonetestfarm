// Package coordinator_server implements coordinator HTTP, WebSockets, and administrative APIs.
//
// File: proxy.go
// Reverse-proxy for per-device stream endpoints so that remote browsers only
// ever need to reach the coordinator (single port, single tunnel ingress).
//
// The provider exposes each claimed device's stream server on its own port
// (e.g. ws://provider:7400/ws). Instead of requiring direct network access to
// every provider/stream port, the coordinator forwards:
//
//	/api/v1/devices/{serial}/ws     → http://{provider_ip}:{stream_port}/ws
//	/api/v1/devices/{serial}/stream → …/stream
//	/api/v1/devices/{serial}/state  → …/state
//	/api/v1/devices/{serial}/upload → …/upload
//
// WebSocket upgrades (the /ws video+control channel) are handled natively by
// httputil.ReverseProxy.

package coordinator_server

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// streamProxySubpaths are the device stream endpoints exposed through the
// coordinator. Registered individually (rather than one wildcard) so unknown
// subpaths fall through to handleDeviceAction's 400 instead of being proxied.
var streamProxySubpaths = []string{"ws", "stream", "state", "upload"}

// registerStreamProxyRoutes registers /api/v1/devices/{serial}/{subpath} for
// each proxied subpath. These patterns are more specific than the existing
// "/api/v1/devices/" subtree, so claim/release/control keep working unchanged.
func (s *Server) registerStreamProxyRoutes(mux *http.ServeMux) {
	for _, sub := range streamProxySubpaths {
		mux.HandleFunc("/api/v1/devices/"+subPathPattern(sub), s.handleStreamProxy)
	}
}

// subPathPattern returns the mux pattern for a stream subpath.
func subPathPattern(sub string) string {
	return "{serial}/" + sub
}

// handleStreamProxy reverse-proxies one request to the device's stream server
// on its provider. Requires an active stream (claimed device) — resolved from
// the devices table like the claim flow does.
func (s *Server) handleStreamProxy(w http.ResponseWriter, r *http.Request) {
	serial := r.PathValue("serial")
	sub := streamSubpathFromPath(r.URL.Path)

	device, err := s.getDevice(serial)
	if err != nil {
		http.Error(w, fmt.Sprintf("device %q not found", serial), http.StatusNotFound)
		return
	}

	if device.StreamPort <= 0 || device.ProviderID == "" {
		http.Error(w, "no active stream for this device (claim it first)", http.StatusConflict)
		return
	}

	target := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("%s:%d", device.ProviderID, device.StreamPort),
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			// The provider's stream server routes on the bare subpath (/ws, /upload…),
			// not the coordinator's /api/v1/devices/{serial}/… prefix.
			pr.Out.URL.Path = "/" + sub
			// Drop the auth token query param before forwarding — the provider's
			// stream endpoints do their own (permissive) auth and the token must
			// not leak to the edge network.
			q := pr.In.URL.Query()
			q.Del("token")
			pr.Out.URL.RawQuery = q.Encode()
			// Ensure the forwarded Host matches the provider, not the public tunnel hostname.
			pr.SetXForwarded()
			pr.Out.Host = target.Host
		},
		// Flush immediately: critical for low-latency H.264/JPEG video chunks,
		// NDJSON upload progress, and the WebSocket upgrade handshake.
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Warn("coordinator: stream proxy error",
				"serial", serial, "provider", target.Host, "path", r.URL.Path, "err", err)
			http.Error(w, fmt.Sprintf("provider stream unreachable (%s): %v", target.Host, err), http.StatusBadGateway)
		},
	}

	slog.Debug("coordinator: proxying stream request",
		"serial", serial, "sub", sub, "target", target.Host,
		"remote_addr", r.RemoteAddr)

	proxy.ServeHTTP(w, r)
}

// streamSubpathFromPath extracts the trailing subpath segment of
// /api/v1/devices/{serial}/{subpath}.
func streamSubpathFromPath(p string) string {
	trimmed := strings.TrimSuffix(strings.TrimPrefix(p, "/api/v1/devices/"), "/")
	if i := strings.LastIndex(trimmed, "/"); i >= 0 {
		return trimmed[i+1:]
	}
	return ""
}
