package grant

import (
	"context"
	"strings"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AutomationToken is an independent machine credential. Its stable ID is used
// as the execution session ID, reusing Grant authorization without changing the
// existing browser/desktop session schema or its constraints.
type AutomationToken struct {
	SessionID    uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	Name         string     `gorm:"size:100;not null" json:"name"`
	GrantID      uuid.UUID  `gorm:"type:char(36);not null" json:"grant_id"`
	GrantVersion int64      `gorm:"not null" json:"-"`
	TokenHash    string     `gorm:"size:64;uniqueIndex;not null" json:"-"`
	CreatedAt    time.Time  `json:"created_at"`
	LastSeenAt   time.Time  `json:"last_used_at"`
	ExpiresAt    time.Time  `json:"expires_at"`
	RevokedAt    *time.Time `json:"revoked_at"`
}

func (AutomationToken) TableName() string { return "automation_tokens" }
func (t AutomationToken) executionSession() Session {
	return Session{ID: t.SessionID, GrantID: t.GrantID, GrantVersion: t.GrantVersion, ClientKind: "automation", CreatedAt: t.CreatedAt, LastSeenAt: t.LastSeenAt, ExpiresAt: t.ExpiresAt, RevokedAt: t.RevokedAt}
}

type TokenView struct {
	SessionID  uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	GrantID    uuid.UUID  `json:"grant_id"`
	GrantName  string     `json:"grant_name"`
	CreatedAt  time.Time  `json:"created_at"`
	LastSeenAt *time.Time `json:"last_used_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	RevokedAt  *time.Time `json:"revoked_at"`
	Active     bool       `json:"active"`
}
type CreateTokenInput struct {
	Name          string                     `json:"name"`
	GrantID       uuid.UUID                  `json:"grant_id"`
	ExpiresAt     time.Time                  `json:"expires_at"`
	Authorization *protocol.CreateGrantInput `json:"authorization,omitempty"`
}

func (s *Service) CreateToken(ctx context.Context, scope access.Scope, input CreateTokenInput) (TokenView, string, error) {
	var view TokenView
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return view, "", err
	}
	input.Name = strings.TrimSpace(input.Name)
	now := time.Now().UTC()
	if input.Name == "" || len(input.Name) > 100 || (input.GrantID == uuid.Nil) == (input.Authorization == nil) || !input.ExpiresAt.After(now) || input.ExpiresAt.After(now.Add(366*24*time.Hour)) {
		return view, "", invalidRequest("name, grant and expiry within one year are required")
	}
	if input.Authorization != nil {
		input.Authorization.Name = input.Name
		input.Authorization.ExpiresAt = &input.ExpiresAt
		input.Authorization.LongLived = false
		if err := normalizeRequestFor(input.Authorization, now, true); err != nil {
			return view, "", err
		}
	}
	secret, err := randomSecret()
	if err != nil {
		return view, "", err
	}
	token := "ess_api_" + secret
	hash := digest(token)
	s.mu.Lock()
	defer s.mu.Unlock()
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var g Grant
		if input.Authorization != nil {
			req := input.Authorization
			// Separate, undisclosed entropy: the machine credential cannot become a share link.
			secret, err := randomSecret()
			if err != nil {
				return err
			}
			g = Grant{ID: uuid.New(), PublicID: uuid.NewString(), SecretHash: digest(secret), Name: input.Name, Version: 1, Purpose: "automation", DefaultContent: req.DefaultContent, ExpiresAt: &input.ExpiresAt, MaxSessions: req.MaxSessions, MaxConnections: req.MaxConnections, UploadLimit: req.UploadLimit, DownloadLimit: req.DownloadLimit, AIRequestLimit: req.AIRequestLimit, CreatedAt: now, UpdatedAt: now}
			if err := tx.Create(&g).Error; err != nil {
				return err
			}
			if err := s.writeResources(ctx, tx, g.ID, req.Resources, nil); err != nil {
				return err
			}
			if err := recordGrantConfiguration(tx, scope.Actor(), g, "grant_create", []string{"created"}, nil); err != nil {
				return err
			}
		} else if err := tx.First(&g, "id = ?", input.GrantID).Error; err != nil {
			return err
		}
		if err := activeGrant(g, now); err != nil {
			return err
		}
		if g.ExpiresAt != nil && input.ExpiresAt.After(*g.ExpiresAt) {
			return invalidRequest("token expiry exceeds grant expiry")
		}
		var count int64
		if err := tx.Table("automation_tokens AS t").Joins("JOIN grants g ON g.id = t.grant_id").Where("t.revoked_at IS NULL AND t.expires_at > ? AND g.revoked_at IS NULL AND t.grant_version = g.version AND (g.expires_at IS NULL OR g.expires_at > ?)", now, now).Count(&count).Error; err != nil {
			return err
		}
		if count >= 100 {
			return access.ErrCapacity
		}
		row := AutomationToken{SessionID: uuid.New(), Name: input.Name, GrantID: g.ID, GrantVersion: g.Version, TokenHash: hash, CreatedAt: now, LastSeenAt: now, ExpiresAt: input.ExpiresAt.UTC()}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		session := row.executionSession()
		view = TokenView{SessionID: session.ID, Name: input.Name, GrantID: g.ID, GrantName: g.Name, CreatedAt: now, ExpiresAt: session.ExpiresAt, Active: true}
		return operationrecord.RecordConfiguration(tx, scope.Actor(), operationrecord.ConfigurationChange{Action: "token_create", ResourceKind: "access_token", ResourceID: session.ID.String(), Name: input.Name, Source: "manual", Fields: []string{"created"}})
	})
	if err != nil {
		return TokenView{}, "", err
	}
	return view, token, nil
}

func (s *Service) ListTokens(ctx context.Context, scope access.Scope) ([]TokenView, error) {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return nil, err
	}
	items := []TokenView{}
	err := s.db.WithContext(ctx).Table("automation_tokens AS s").Select("s.session_id, s.name, s.grant_id, g.name AS grant_name, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at, (s.revoked_at IS NULL AND g.revoked_at IS NULL AND s.grant_version = g.version AND s.expires_at > ? AND (g.expires_at IS NULL OR g.expires_at > ?)) AS active", time.Now().UTC(), time.Now().UTC()).Joins("JOIN grants g ON g.id=s.grant_id").Order("active DESC, s.created_at DESC").Limit(500).Scan(&items).Error
	for i := range items {
		if items[i].LastSeenAt != nil && !items[i].LastSeenAt.After(items[i].CreatedAt) {
			items[i].LastSeenAt = nil
		}
	}
	return items, err
}

func (s *Service) AuthenticateToken(ctx context.Context, raw string) (access.Scope, error) {
	if !strings.HasPrefix(raw, "ess_api_") || len(raw) != 51 {
		return access.Scope{}, access.ErrUnauthenticated
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var scope access.Scope
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var token AutomationToken
		if err := tx.Where("token_hash = ?", digest(raw)).First(&token).Error; err != nil {
			return access.ErrUnauthenticated
		}
		session, _, err := s.sessionState(ctx, tx, token.SessionID.String())
		if err != nil {
			return err
		}
		scope, err = access.NewScope(actorOf(session), session.ExpiresAt, s)
		if err != nil {
			return err
		}
		return tx.Model(&AutomationToken{}).Where("session_id = ?", session.ID).Update("last_seen_at", time.Now().UTC()).Error
	})
	return scope, err
}

func (s *Service) RevokeToken(ctx context.Context, scope access.Scope, id uuid.UUID) error {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var token AutomationToken
		if err := tx.First(&token, "session_id = ?", id).Error; err != nil {
			return err
		}
		if token.RevokedAt != nil {
			return nil
		}
		if err := tx.Model(&token).Update("revoked_at", time.Now().UTC()).Error; err != nil {
			return err
		}
		return operationrecord.RecordConfiguration(tx, scope.Actor(), operationrecord.ConfigurationChange{Action: "token_revoke", ResourceKind: "access_token", ResourceID: id.String(), Name: token.Name, Source: "manual", Fields: []string{"revoked_at"}})
	})
	if err == nil {
		s.runtime.Invalidate("", id.String(), "", access.ErrRevoked)
	}
	return err
}
