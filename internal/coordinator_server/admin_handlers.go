// Package coordinator_server implements coordinator HTTP, WebSockets, and administrative APIs.
//
// File: admin_handlers.go
// This file contains implementation and helper structures for coordinator HTTP, WebSockets, and administrative APIs.

package coordinator_server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"protean-provider/internal/auth"
	"protean-provider/internal/domain"
)

func isSuperAdmin(r *http.Request) bool {
	userInfo, ok := auth.FromContext(r.Context())
	if !ok {
		return false
	}
	return strings.EqualFold(userInfo.Email, "sammyseth260@gmail.com") || userInfo.Role == string(domain.RoleAdmin)
}

func (s *Server) canManageGroup(r *http.Request, groupID string) bool {
	if isSuperAdmin(r) {
		return true
	}
	userInfo, ok := auth.FromContext(r.Context())
	if !ok {
		return false
	}
	grp, err := s.db.GetGroup(groupID)
	if err != nil || grp == nil {
		return false
	}
	return grp.AdminID != nil && *grp.AdminID == userInfo.ID
}

// checkAdmin performs the check admin operation.
func (s *Server) checkAdmin(w http.ResponseWriter, r *http.Request) bool {
	userInfo, ok := auth.FromContext(r.Context())
	if !ok || (userInfo.Role != string(domain.RoleAdmin) && userInfo.Role != string(domain.RoleGroupAdmin) && !strings.EqualFold(userInfo.Email, "sammyseth260@gmail.com")) {
		http.Error(w, "Forbidden: administrator privileges required", http.StatusForbidden)
		return false
	}
	return true
}

// handleAdminUsers handles the admin users request/event.
func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if !s.checkAdmin(w, r) {
		return
	}

	if r.Method == http.MethodGet {
		users, err := s.db.ListUsers()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(users)
		return
	}

	if r.Method == http.MethodDelete {
		if !isSuperAdmin(r) {
			http.Error(w, "Forbidden: Only Super Admin can delete users", http.StatusForbidden)
			return
		}
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, "id query parameter is required", http.StatusBadRequest)
			return
		}
		if err := s.db.DeleteUser(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// handleAdminGroups handles the admin groups request/event.
func (s *Server) handleAdminGroups(w http.ResponseWriter, r *http.Request) {
	if !s.checkAdmin(w, r) {
		return
	}

	if r.Method == http.MethodGet {
		groups, err := s.db.ListGroups()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// If group admin (not super admin), filter to only groups they administer
		if !isSuperAdmin(r) {
			userInfo, _ := auth.FromContext(r.Context())
			var filtered []domain.Group
			for _, g := range groups {
				if g.AdminID != nil && *g.AdminID == userInfo.ID {
					filtered = append(filtered, g)
				}
			}
			groups = filtered
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(groups)
		return
	}

	if r.Method == http.MethodPost {
		if !isSuperAdmin(r) {
			http.Error(w, "Forbidden: Only Super Admin (sammyseth260@gmail.com) can create groups", http.StatusForbidden)
			return
		}
		var req struct {
			Name        string     `json:"name"`
			Description string     `json:"description"`
			AdminID     *string    `json:"admin_id,omitempty"`
			ExpiresAt   *time.Time `json:"expires_at,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}

		g := &domain.Group{
			ID:          uuid.New().String(),
			Name:        req.Name,
			Description: req.Description,
			AdminID:     req.AdminID,
			CreatedAt:   time.Now(),
			ExpiresAt:   req.ExpiresAt,
		}
		if err := s.db.CreateGroup(g); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Ensure assigned group admin receives role group_admin
		if req.AdminID != nil && *req.AdminID != "" {
			_, _ = s.db.RawDB().Exec(`UPDATE users SET role = $1 WHERE id = $2 AND role = 'user'`, string(domain.RoleGroupAdmin), *req.AdminID)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(g)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// handleAdminGroupAction handles the admin group action request/event.
func (s *Server) handleAdminGroupAction(w http.ResponseWriter, r *http.Request) {
	if !s.checkAdmin(w, r) {
		return
	}

	relPath := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/groups/")
	parts := strings.Split(relPath, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Group ID is required", http.StatusBadRequest)
		return
	}
	groupID := parts[0]

	if !s.canManageGroup(r, groupID) {
		http.Error(w, "Forbidden: You do not have administration privileges for this group scope", http.StatusForbidden)
		return
	}

	// 1. DELETE /api/v1/admin/groups/{group_id}
	if len(parts) == 1 {
		if r.Method != http.MethodDelete {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !isSuperAdmin(r) {
			http.Error(w, "Forbidden: Only Super Admin can delete groups", http.StatusForbidden)
			return
		}
		if err := s.db.DeleteGroup(groupID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
		return
	}

	subResource := parts[1]

	// 2. Users resource
	if subResource == "users" {
		if len(parts) == 2 {
			if r.Method == http.MethodGet {
				users, err := s.db.GetGroupUsers(groupID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(users)
				return
			}

			// POST /api/v1/admin/groups/{group_id}/users
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			var req struct {
				UserID string `json:"user_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			if req.UserID == "" {
				http.Error(w, "user_id is required", http.StatusBadRequest)
				return
			}
			if err := s.db.AddUserToGroup(req.UserID, groupID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}

		if len(parts) == 3 {
			// DELETE /api/v1/admin/groups/{group_id}/users/{user_id}
			if r.Method != http.MethodDelete {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			userID := parts[2]
			if err := s.db.RemoveUserFromGroup(userID, groupID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}
	}

	// 3. Devices resource
	if subResource == "devices" {
		if len(parts) == 2 {
			if r.Method == http.MethodGet {
				devices, err := s.db.GetGroupDevicesDetailed(groupID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(devices)
				return
			}

			// POST /api/v1/admin/groups/{group_id}/devices
			// Only Super Admin can assign devices into a group from the fleet
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if !isSuperAdmin(r) {
				http.Error(w, "Forbidden: Only Super Admin can allocate hardware devices to groups", http.StatusForbidden)
				return
			}
			var req struct {
				Serial string  `json:"serial"`
				UserID *string `json:"user_id,omitempty"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			if req.Serial == "" {
				http.Error(w, "serial is required", http.StatusBadRequest)
				return
			}
			if err := s.db.AddDeviceToGroup(req.Serial, groupID, req.UserID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}

		if len(parts) == 3 {
			serial := parts[2]

			// PATCH /api/v1/admin/groups/{group_id}/devices/{serial}
			// Both Super Admin and Group Admin can assign/reassign group devices to specific users in the group
			if r.Method == http.MethodPatch {
				var req struct {
					UserID *string `json:"user_id"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "invalid request body", http.StatusBadRequest)
					return
				}
				if err := s.db.AssignDeviceToUser(serial, groupID, req.UserID); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
				return
			}

			// DELETE /api/v1/admin/groups/{group_id}/devices/{serial}
			// Only Super Admin can revoke a device from the group
			if r.Method == http.MethodDelete {
				if !isSuperAdmin(r) {
					http.Error(w, "Forbidden: Only Super Admin can remove devices from groups", http.StatusForbidden)
					return
				}
				if err := s.db.RemoveDeviceFromGroup(serial, groupID); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
				return
			}

			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
	}

	http.Error(w, "Not found", http.StatusNotFound)
}
