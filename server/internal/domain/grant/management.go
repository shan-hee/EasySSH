package grant

import (
	"context"
	"errors"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Service) List(ctx context.Context, scope access.Scope, limit, offset int) ([]protocol.Grant, int64, error) {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return nil, 0, err
	}
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, 0, invalidRequest("invalid pagination")
	}
	var count int64
	var grants []Grant
	if err := s.db.WithContext(ctx).Model(&Grant{}).Where("purpose <> ?", "automation").Count(&count).Error; err != nil {
		return nil, 0, err
	}
	err := s.db.WithContext(ctx).Where("purpose <> ?", "automation").Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&grants).Error
	if err != nil {
		return nil, 0, err
	}
	result := make([]protocol.Grant, 0, len(grants))
	for _, row := range grants {
		result = append(result, row.Public())
	}
	return result, count, nil
}

func (s *Service) Detail(ctx context.Context, scope access.Scope, id uuid.UUID) (*protocol.GrantDetail, error) {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return nil, err
	}
	result := protocol.GrantDetail{Scripts: []protocol.GrantScriptScope{}, Sessions: []protocol.AccessSession{}}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Grant
		if err := tx.Where("id = ?", id).First(&row).Error; err != nil {
			return err
		}
		result.Grant = row.Public()
		var err error
		result.Resources, err = s.resourceViews(ctx, tx, id)
		if err != nil {
			return err
		}
		var scripts []ScriptScope
		if err := tx.Where("grant_id = ?", id).Order("server_id, script_id").Find(&scripts).Error; err != nil {
			return err
		}
		for _, script := range scripts {
			result.Scripts = append(result.Scripts, protocol.GrantScriptScope{ServerID: script.ServerID, ScriptID: script.ScriptID, Version: script.Version, Parameters: script.Parameters})
		}
		var sessions []Session
		if err := tx.Where("grant_id = ?", id).Order("created_at DESC").Limit(100).Find(&sessions).Error; err != nil {
			return err
		}
		for _, session := range sessions {
			result.Sessions = append(result.Sessions, protocol.AccessSession{ID: session.ID, GrantID: session.GrantID, GrantVersion: session.GrantVersion, ClientKind: session.ClientKind, CreatedAt: session.CreatedAt, LastSeenAt: session.LastSeenAt, ExpiresAt: session.ExpiresAt, RevokedAt: session.RevokedAt})
		}
		return nil
	})
	return &result, err
}

// Update replaces the explicit permission set and invalidates old sessions. It
// preserves resource approval revisions; ConfirmResource is the only reconfirmation.
func (s *Service) Update(ctx context.Context, scope access.Scope, id uuid.UUID, version int64, req protocol.CreateGrantInput) error {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return err
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var g Grant
		if err := tx.Where("id = ? AND version = ?", id, version).First(&g).Error; err != nil {
			return err
		}
		if err := normalizeRequestFor(&req, now, g.Purpose == "automation"); err != nil {
			return err
		}
		if g.RevokedAt != nil {
			return access.ErrRevoked
		}
		var old []Resource
		if err := tx.Where("grant_id = ?", id).Find(&old).Error; err != nil {
			return err
		}
		previous, err := grantActivityResources(tx, id)
		if err != nil {
			return err
		}
		approved := make(map[uuid.UUID]int64, len(old))
		for _, r := range old {
			approved[r.ServerID] = r.ApprovedConnectionRevision
		}
		if err := tx.Where("grant_id = ?", id).Delete(&ScriptScope{}).Error; err != nil {
			return err
		}
		if err := tx.Where("grant_id = ?", id).Delete(&Resource{}).Error; err != nil {
			return err
		}
		if err := s.writeResources(ctx, tx, id, req.Resources, approved); err != nil {
			return err
		}
		result := tx.Model(&Grant{}).Where("id = ? AND version = ?", id, version).Updates(map[string]any{
			"name": req.Name, "default_content": req.DefaultContent, "expires_at": req.ExpiresAt,
			"version": version + 1, "max_sessions": req.MaxSessions, "max_connections": req.MaxConnections,
			"upload_limit": req.UploadLimit, "download_limit": req.DownloadLimit, "ai_request_limit": req.AIRequestLimit,
			"updated_at": now,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return access.ErrResourceChanged
		}
		if err := tx.Model(&Session{}).Where("grant_id = ? AND revoked_at IS NULL", id).Update("revoked_at", now).Error; err != nil {
			return err
		}
		g.Name = req.Name
		// Even equivalent permissions explicitly advance the version and end old sessions.
		return recordGrantConfiguration(tx, scope.Actor(), g, "grant_update", []string{"version"}, previous)
	})
	if err == nil {
		s.runtime.Invalidate(id.String(), "", "", access.ErrRevoked)
	}
	return err
}

func (s *Service) Revoke(ctx context.Context, scope access.Scope, id uuid.UUID) error {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var g Grant
		if err := tx.Where("id = ?", id).First(&g).Error; err != nil {
			return err
		}
		if g.RevokedAt != nil {
			return nil
		}
		if err := tx.Model(&g).Updates(map[string]any{"revoked_at": now, "version": g.Version + 1}).Error; err != nil {
			return err
		}
		if err := tx.Model(&Session{}).Where("grant_id = ? AND revoked_at IS NULL", id).Update("revoked_at", now).Error; err != nil {
			return err
		}
		return recordGrantConfiguration(tx, scope.Actor(), g, "grant_revoke", []string{"revoked_at", "version"}, nil)
	})
	if err == nil {
		s.runtime.Invalidate(id.String(), "", "", access.ErrRevoked)
	}
	return err
}

func (s *Service) RotateSecret(ctx context.Context, scope access.Scope, id uuid.UUID) (*protocol.GrantCreated, error) {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return nil, err
	}
	raw, err := s.publicURL(ctx)
	if err != nil {
		return nil, err
	}
	origin, err := publicOrigin(raw)
	if err != nil {
		return nil, err
	}
	secret, err := randomSecret()
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var g Grant
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ?", id).First(&g).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		if g.Purpose == "automation" {
			return access.ErrForbidden
		}
		if err := activeGrant(g, now); err != nil {
			return err
		}
		g.SecretHash, g.Version, g.UpdatedAt = digest(secret), g.Version+1, now
		if err := tx.Save(&g).Error; err != nil {
			return err
		}
		if err := tx.Model(&Session{}).Where("grant_id = ? AND revoked_at IS NULL", id).Update("revoked_at", now).Error; err != nil {
			return err
		}
		return recordGrantConfiguration(tx, scope.Actor(), g, "grant_rotate_secret", []string{"secret", "version"}, nil)
	})
	if err != nil {
		return nil, err
	}
	s.runtime.Invalidate(id.String(), "", "", access.ErrRevoked)
	return &protocol.GrantCreated{Grant: g.Public(), Link: origin + "/share/" + g.PublicID + "#" + secret}, nil
}

func (s *Service) EndSession(ctx context.Context, scope access.Scope, id uuid.UUID) error {
	if scope.IsOwner() {
		if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
			return err
		}
	} else {
		if scope.Actor().SessionID != id.String() || scope.Actor().Kind != protocol.Visitor {
			return access.ErrForbidden
		}
		if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
			return err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var session Session
		if err := tx.First(&session, "id=?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if session.RevokedAt != nil {
			return nil
		}
		if err := tx.Model(&session).Update("revoked_at", time.Now().UTC()).Error; err != nil {
			return err
		}
		// Visitor logout is not an owner configuration change.
		if !scope.IsOwner() {
			return nil
		}
		var g Grant
		if err := tx.First(&g, "id=?", session.GrantID).Error; err != nil {
			return err
		}
		resources, err := grantActivityResources(tx, g.ID)
		if err != nil {
			return err
		}
		return operationrecord.RecordConfiguration(tx, scope.Actor(), operationrecord.ConfigurationChange{
			Action: "grant_end_session", ResourceKind: "access_session", ResourceID: session.ID.String(), Name: g.Name,
			Source: "manual", Fields: []string{"revoked_at"}, Resources: resources,
		})
	})
	if err == nil {
		s.runtime.Invalidate("", id.String(), "", access.ErrRevoked)
	}
	return err
}

func (s *Service) ConfirmResource(ctx context.Context, scope access.Scope, grantID, serverID uuid.UUID, revision int64) error {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var r Resource
		if err := tx.Where("grant_id = ? AND server_id = ?", grantID, serverID).First(&r).Error; err != nil {
			return err
		}
		resource, current, err := s.catalog.Resource(ctx, tx, serverID)
		if err != nil {
			return err
		}
		if current != revision {
			return access.ErrResourceChanged
		}
		if err := s.resourceReady(ctx, tx, serverID, r.Actions, r.AllowInteractive); err != nil {
			return err
		}
		if r.ApprovedConnectionRevision == revision {
			return nil
		}
		var g Grant
		if err := tx.First(&g, "id=?", grantID).Error; err != nil {
			return err
		}
		if err := tx.Model(&r).Update("approved_connection_revision", revision).Error; err != nil {
			return err
		}
		return operationrecord.RecordConfiguration(tx, scope.Actor(), operationrecord.ConfigurationChange{
			Action: "grant_confirm_resource", ResourceKind: "grant", ResourceID: grantID.String(), Name: g.Name,
			Source: "manual", Fields: []string{"approved_connection_revision"},
			Resources: []operationrecord.ResourceSnapshot{{ServerID: serverID, Name: resource.Name}},
		})
	})
}

// ResourceChanged is invoked only after the resource transaction commits.
// Grant IDs are discovered through existing leases; unrelated targets survive.
func (s *Service) ResourceChanged(serverID uuid.UUID) {
	// Only visitor work is subject to grant approval. Owner work has its own
	// configuration lifecycle and must not be cancelled by this notification.
	s.runtime.InvalidateVisitors(serverID.String(), access.ErrResourceChanged)
}

// Charge atomically consumes an amount before forwarding a bounded chunk or
// starting an AI request. Retries consume their own transferred bytes.
func (s *Service) Charge(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	if amount <= 0 {
		return invalidRequest("quota amount must be positive")
	}
	if err := scope.Check(ctx, req); err != nil {
		return err
	}
	if scope.IsOwner() {
		return nil
	}
	used, limit, err := quotaColumns(req.Action)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := scope.Check(ctx, req); err != nil {
		return err
	}
	result := s.db.WithContext(ctx).Model(&Grant{}).
		Where("id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", scope.Actor().GrantID, time.Now().UTC()).
		Where("("+limit+" IS NULL OR "+used+" <= "+limit+" - ?)", amount).
		Where(used+" <= ?", int64(1<<63-1)-amount).
		UpdateColumn(used, gorm.Expr(used+" + ?", amount))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrQuota
	}
	return nil
}

func quotaColumns(action protocol.Action) (string, string, error) {
	switch action {
	case protocol.FilesUpload, protocol.FilesWrite:
		return "uploaded_bytes", "upload_limit", nil
	case protocol.FilesDownload, protocol.FilesRead:
		return "downloaded_bytes", "download_limit", nil
	case protocol.AIUse:
		return "ai_requests", "ai_request_limit", nil
	default:
		return "", "", access.ErrForbidden
	}
}
