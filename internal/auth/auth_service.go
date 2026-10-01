// Package auth implements authentication, user sessions, JWT handling, and middleware.
//
// File: auth_service.go
// This file contains implementation and helper structures for authentication, user sessions, JWT handling, and middleware.

package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"protean-provider/internal/db"
	"protean-provider/internal/domain"
)

type AuthService struct {
	db         *db.DB
	jwtManager *JWTManager
}

// NewAuthService initializes a new auth service.
func NewAuthService(db *db.DB, jwtManager *JWTManager) *AuthService {
	return &AuthService{
		db:         db,
		jwtManager: jwtManager,
	}
}

// RegisterLocalUser registers a new user with username and password
func (s *AuthService) RegisterLocalUser(email, password string, role domain.UserRole, groups []string) (*domain.User, error) {
	if email == "" || password == "" {
		return nil, errors.New("email and password cannot be empty")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	user := &domain.User{
		ID:           uuid.New().String(),
		Email:        email,
		PasswordHash: string(hash),
		Role:         role,
		AuthProvider: "local",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := s.db.CreateUser(user); err != nil {
		return nil, err
	}

	for _, gName := range groups {
		// Verify if group exists or create it
		gID := uuid.New().String()
		group := &domain.Group{
			ID:          gID,
			Name:        gName,
			Description: fmt.Sprintf("Group for %s", gName),
			CreatedAt:   time.Now(),
		}
		_ = s.db.CreateGroup(group)

		// Get the actual group ID (since CreateGroup uses ON CONFLICT DO NOTHING, we fetch it or join)
		// To be safe, list groups and find the matching ID or write a helper
	}

	// Wait, to add user to groups, we need to know their IDs. Let's find groups by listing them:
	dbGroups, err := s.db.ListGroups()
	if err == nil {
		for _, dbG := range dbGroups {
			for _, gName := range groups {
				if dbG.Name == gName {
					_ = s.db.AddUserToGroup(user.ID, dbG.ID)
				}
			}
		}
	}

	return user, nil
}

// Login validates user credentials and returns a JWT token
func (s *AuthService) Login(email, password string) (string, error) {
	user, err := s.db.GetUserByEmail(email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("invalid email or password")
		}
		return "", err
	}

	if user.AuthProvider != "local" {
		return "", fmt.Errorf("user authenticated via external provider: %s", user.AuthProvider)
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if err != nil {
		return "", errors.New("invalid email or password")
	}

	// Fetch user groups
	groups, err := s.db.GetUserGroups(user.ID)
	var groupNames []string
	if err == nil {
		for _, g := range groups {
			groupNames = append(groupNames, g.Name)
		}
	}

	// Generate JWT (valid for 24 hours)
	return s.jwtManager.GenerateToken(user.ID, user.Email, string(user.Role), groupNames, 24*time.Hour)
}

// ResolveOIDCUser maps a verified external identity (Supabase Auth, OIDC
// provider) to a local user record and returns the enriched UserInfo used by
// the request context.
//
// JWTs from external providers carry only "sub" and "email" — the
// authoritative role and group membership live in the local database:
//
//   - A known user (matched by email) is returned with their stored role.
//     This lets the seeded admin keep admin rights by logging in with a
//     Supabase account that shares the admin email.
//   - An unknown user is auto-provisioned: the very first external login on
//     an empty users table becomes admin; everyone else is a regular user
//     and is added to the "Public" group so they can see shared devices.
func (s *AuthService) ResolveOIDCUser(sub, email string) (UserInfo, error) {
	if sub == "" {
		return UserInfo{}, errors.New("oidc subject (sub) claim is empty")
	}
	if email == "" {
		// Degenerate but possible: derive a placeholder so lookups stay unique.
		email = sub + "@oidc.local"
	}

	user, err := s.db.GetUserByEmail(email)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return UserInfo{}, err
		}

		// Super Admin: sammyseth260@gmail.com is ALWAYS granted RoleAdmin (Super Admin)
		role := domain.RoleUser
		if strings.EqualFold(email, "sammyseth260@gmail.com") {
			role = domain.RoleAdmin
		} else {
			// Auto-provision: first external user on an empty farm becomes admin.
			var userCount int
			if err := s.db.RawDB().QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount); err == nil && userCount == 0 {
				role = domain.RoleAdmin
			}
		}

		user = &domain.User{
			ID:           sub, // Supabase "sub" is a UUID, matching users.id
			Email:        email,
			PasswordHash: "", // no local password — external provider only
			Role:         role,
			AuthProvider: "supabase",
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
		}
		if err := s.db.CreateUser(user); err != nil {
			return UserInfo{}, fmt.Errorf("provision oidc user: %w", err)
		}
		slog.Info("auth: provisioned external user", "email", email, "role", string(role))
	} else if user.AuthProvider != "supabase" {
		// A local (password) account with the same email exists — trust the
		// provider's verified email and adopt the existing account/role.
		user.AuthProvider = "supabase"
		user.UpdatedAt = time.Now()
		if err := s.db.UpdateUserAuthProvider(user.ID, "supabase"); err != nil {
			return UserInfo{}, err
		}
	}

	// Always guarantee sammyseth260@gmail.com has RoleAdmin
	if strings.EqualFold(user.Email, "sammyseth260@gmail.com") && user.Role != domain.RoleAdmin {
		user.Role = domain.RoleAdmin
		_ = s.db.UpdateUserRole(user.ID, domain.RoleAdmin)
	}

	// Non-admin external users still need the Public group to see devices.
	if user.Role != domain.RoleAdmin {
		s.ensurePublicGroupMembership(user.ID)
	}

	groupNames := []string{}
	if groups, err := s.db.GetUserGroups(user.ID); err == nil {
		for _, g := range groups {
			groupNames = append(groupNames, g.Name)
		}
	}

	return UserInfo{
		ID:     user.ID,
		Email:  user.Email,
		Role:   string(user.Role),
		Groups: groupNames,
	}, nil
}

// ensurePublicGroupMembership adds the user to the "Public" group (created by
// db migrations) if not already a member. Best-effort: failures only limit
// visibility of public devices for that user.
func (s *AuthService) ensurePublicGroupMembership(userID string) {
	var groupID string
	if err := s.db.RawDB().QueryRow("SELECT id FROM groups WHERE name = 'Public'").Scan(&groupID); err != nil {
		return
	}
	_ = s.db.AddUserToGroup(userID, groupID)
}

// CreateApiKeyForUser generates a secure API Key, hashes it, and saves it
func (s *AuthService) CreateApiKeyForUser(userID string, name string, expiration *time.Time) (string, error) {
	// Generate random 32-byte secret token
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	rawToken := "pt_live_" + hex.EncodeToString(b)

	// Hash the token using SHA-256
	h := sha256.New()
	h.Write([]byte(rawToken))
	tokenHash := hex.EncodeToString(h.Sum(nil))

	key := &domain.ApiKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		Name:      name,
		TokenHash: tokenHash,
		CreatedAt: time.Now(),
		ExpiresAt: expiration,
	}

	if err := s.db.CreateApiKey(key); err != nil {
		return "", err
	}

	return rawToken, nil
}

// VerifyApiKey validates the raw API key and returns the corresponding user
func (s *AuthService) VerifyApiKey(rawToken string) (*domain.User, error) {
	h := sha256.New()
	h.Write([]byte(rawToken))
	tokenHash := hex.EncodeToString(h.Sum(nil))

	key, err := s.db.GetApiKeyByHash(tokenHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("invalid API key")
		}
		return nil, err
	}

	if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
		return nil, errors.New("expired API key")
	}

	user, err := s.db.GetUserByID(key.UserID)
	if err != nil {
		return nil, err
	}

	return user, nil
}
