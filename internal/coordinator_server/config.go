// Package coordinator_server implements coordinator HTTP, WebSockets, and administrative APIs.
//
// File: config.go
// This file contains implementation and helper structures for coordinator HTTP, WebSockets, and administrative APIs.

package coordinator_server

import (
	"os"
	"strconv"
)

type Config struct {
	GRPCPort        int
	PostgresURI     string
	JWTSecret       string
	JWTIssuer       string
	OIDCJWKSURL     string
	BypassAuthInDev bool
	// StaticDir optionally points at a built frontend (frontend/dist). When
	// set, the coordinator serves the SPA itself so the whole farm is exposed
	// through a single HTTP port (and a single Cloudflare Tunnel ingress).
	StaticDir string
}

// LoadConfig performs the load config operation.
func LoadConfig() Config {
	port := 9000
	if pStr := os.Getenv("COORDINATOR_GRPC_PORT"); pStr != "" {
		if p, err := strconv.Atoi(pStr); err == nil {
			port = p
		}
	}
	dbURI := "postgres://postgres:123456@localhost:5455/flexpulse?sslmode=disable"
	if uri := os.Getenv("COORDINATOR_POSTGRES_URI"); uri != "" {
		dbURI = uri
	}

	jwtSecret := "flexpulse-default-secret-key-change-me-123456"
	if sec := os.Getenv("COORDINATOR_JWT_SECRET"); sec != "" {
		jwtSecret = sec
	}

	jwtIssuer := "flexpulse-coordinator"
	if iss := os.Getenv("COORDINATOR_JWT_ISSUER"); iss != "" {
		jwtIssuer = iss
	}

	oidcJWKS := ""
	if jwks := os.Getenv("COORDINATOR_OIDC_JWKS_URL"); jwks != "" {
		oidcJWKS = jwks
	}

	bypassDev := true
	if bStr := os.Getenv("BYPASS_AUTH_IN_DEV"); bStr != "" {
		if b, err := strconv.ParseBool(bStr); err == nil {
			bypassDev = b
		}
	}

	staticDir := ""
	if dir := os.Getenv("COORDINATOR_STATIC_DIR"); dir != "" {
		staticDir = dir
	}

	return Config{
		GRPCPort:        port,
		PostgresURI:     dbURI,
		JWTSecret:       jwtSecret,
		JWTIssuer:       jwtIssuer,
		OIDCJWKSURL:     oidcJWKS,
		BypassAuthInDev: bypassDev,
		StaticDir:       staticDir,
	}
}
