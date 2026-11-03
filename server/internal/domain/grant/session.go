package grant

import (
	"context"
	"crypto/subtle"
	"errors"
	"github.com/easyssh/shared/protocol"
	"log"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	sessionLifetime   = 12 * time.Hour
	containerLifetime = 30 * 24 * time.Hour
	idleLifetime      = 30 * time.Minute
)

type ExchangeRequest struct {
	protocol.AccessExchangeInput
	// Transport credentials are populated by the HTTP adapter, not JSON input.
	ContainerToken string `json:"-"`
	SessionToken   string `json:"-"`
}

type ExchangeResult struct {
	Context        protocol.AccessContext `json:"context"`
	SessionToken   string                 `json:"-"`
	ContainerToken string                 `json:"-"`
	CSRFToken      string                 `json:"-"`
}

func csrfToken(containerToken string) string { return digest("easyssh:access:csrf:" + containerToken) }

func (s *Service) Exchange(ctx context.Context, req ExchangeRequest) (*ExchangeResult, error) {
	if req.ProtocolMin > ProtocolVersion || req.ProtocolMax < ProtocolVersion || req.ProtocolMin < 1 || req.ProtocolMax < req.ProtocolMin {
		return nil, ErrProtocol
	}
	if req.ClientKind != "browser" && req.ClientKind != "desktop" {
		return nil, invalidRequest("unsupported access client")
	}
	if len(req.Secret) > 128 || len(req.PublicID) > 64 {
		return nil, ErrInvalidLink
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var result ExchangeResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var g Grant
		if err := tx.Where("public_id = ?", req.PublicID).First(&g).Error; err != nil {
			return ErrInvalidLink
		}
		now := time.Now().UTC()
		if g.Purpose == "automation" || !matches(req.Secret, g.SecretHash) || activeGrant(g, now) != nil {
			return ErrInvalidLink
		}
		resources, err := s.resourceViews(ctx, tx, g.ID)
		if err != nil {
			return err
		}
		available := false
		for _, resource := range resources {
			available = available || !resource.Paused
		}
		if !available {
			return ErrInvalidLink
		}
		var container *BrowserContainer
		if req.ClientKind == "browser" {
			var token string
			container, token, err = s.exchangeContainer(tx, req.ContainerToken, now)
			if err != nil {
				return err
			}
			result.ContainerToken, result.CSRFToken = token, csrfToken(token)
		}
		if err := s.reclaimIdle(tx, g.ID, now); err != nil {
			return err
		}
		var session Session
		query := tx.Where("grant_id = ? AND grant_version = ? AND revoked_at IS NULL AND expires_at > ? AND client_kind = ?", g.ID, g.Version, now, req.ClientKind)
		canReuse := container != nil || req.SessionToken != ""
		if container != nil {
			query = query.Where("container_id = ?", container.ID)
		} else {
			query = query.Where("token_hash = ?", digest(req.SessionToken))
		}
		err = gorm.ErrRecordNotFound
		if canReuse {
			err = query.First(&session).Error
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			session, result.SessionToken, err = s.issueSession(tx, g, req.ClientKind, container, now)
			if err != nil {
				return err
			}
		} else {
			if req.ClientKind == "desktop" {
				result.SessionToken = req.SessionToken
			}
			if err := tx.Model(&Session{}).Where("id = ?", session.ID).Update("last_seen_at", now).Error; err != nil {
				return err
			}
		}
		result.Context = contextOf(session, g, resources)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *Service) exchangeContainer(tx *gorm.DB, token string, now time.Time) (*BrowserContainer, string, error) {
	var c BrowserContainer
	if token != "" {
		if err := tx.Where("token_hash = ? AND expires_at > ?", digest(token), now).First(&c).Error; err != nil {
			return nil, "", access.ErrUnauthenticated
		}
		return &c, token, nil
	}
	token, err := randomSecret()
	if err != nil {
		return nil, "", err
	}
	c = BrowserContainer{ID: uuid.New(), TokenHash: digest(token), CSRFHash: digest(csrfToken(token)), CreatedAt: now, ExpiresAt: now.Add(containerLifetime)}
	if err := tx.Create(&c).Error; err != nil {
		return nil, "", err
	}
	return &c, token, nil
}

func (s *Service) issueSession(tx *gorm.DB, g Grant, client string, container *BrowserContainer, now time.Time) (Session, string, error) {
	var count int64
	if err := tx.Model(&Session{}).Where("grant_id = ? AND grant_version = ? AND revoked_at IS NULL AND expires_at > ?", g.ID, g.Version, now).Count(&count).Error; err != nil {
		return Session{}, "", err
	}
	if count >= int64(g.MaxSessions) {
		return Session{}, "", access.ErrCapacity
	}
	session := Session{ID: uuid.New(), GrantID: g.ID, GrantVersion: g.Version, ClientKind: client,
		CreatedAt: now, LastSeenAt: now, ExpiresAt: now.Add(sessionLifetime)}
	if g.ExpiresAt != nil && g.ExpiresAt.Before(session.ExpiresAt) {
		session.ExpiresAt = *g.ExpiresAt
	}
	var token string
	if container != nil {
		session.ContainerID = &container.ID
		if container.ExpiresAt.Before(session.ExpiresAt) {
			session.ExpiresAt = container.ExpiresAt
		}
	} else {
		var err error
		token, err = randomSecret()
		if err != nil {
			return Session{}, "", err
		}
		hash := digest(token)
		session.TokenHash = &hash
	}
	if err := tx.Create(&session).Error; err != nil {
		return Session{}, "", err
	}
	return session, token, nil
}

func (s *Service) reclaimIdle(tx *gorm.DB, grantID uuid.UUID, now time.Time) error {
	var sessions []Session
	query := tx.Where("revoked_at IS NULL AND last_seen_at <= ?", now.Add(-idleLifetime))
	if grantID != uuid.Nil {
		query = query.Where("grant_id = ?", grantID)
	}
	if err := query.Find(&sessions).Error; err != nil {
		return err
	}
	for _, session := range sessions {
		if s.runtime.Busy(session.ID.String()) {
			continue
		}
		if err := tx.Model(&Session{}).Where("id = ? AND revoked_at IS NULL", session.ID).Update("revoked_at", now).Error; err != nil {
			return err
		}
	}
	return nil
}

// Run reclaims abandoned slots even if nobody opens another share. Cancellation
// and resource-revision checks are handled by the shared execution runtime.
func (s *Service) Run(ctx context.Context) error {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			s.mu.Lock()
			err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				return s.reclaimIdle(tx, uuid.Nil, time.Now().UTC())
			})
			s.mu.Unlock()
			if err != nil && ctx.Err() == nil {
				log.Printf("access idle-session cleanup failed; will retry: %v", err)
			}
		}
	}
}

// Authenticate chooses exactly one transport. An invalid visitor credential is
// never retried as an owner login, even if an owner cookie also exists.
func (s *Service) Authenticate(ctx context.Context, sessionID, nativeToken, containerToken, csrf string, mutation bool) (access.Scope, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var scope access.Scope
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var id string
		if nativeToken != "" && containerToken == "" {
			var session Session
			if err := tx.Where("token_hash = ? AND client_kind = ?", digest(nativeToken), "desktop").First(&session).Error; err != nil {
				return access.ErrUnauthenticated
			}
			id = session.ID.String()
			if sessionID != "" && sessionID != id {
				return access.ErrForbidden
			}
		} else if containerToken != "" && nativeToken == "" && sessionID != "" {
			var container BrowserContainer
			if err := tx.Where("token_hash = ? AND expires_at > ?", digest(containerToken), time.Now().UTC()).First(&container).Error; err != nil {
				return access.ErrUnauthenticated
			}
			if mutation && !matches(csrf, container.CSRFHash) {
				return access.ErrForbidden
			}
			var session Session
			if err := tx.Where("id = ? AND container_id = ? AND client_kind = ?", sessionID, container.ID, "browser").First(&session).Error; err != nil {
				return access.ErrUnauthenticated
			}
			id = session.ID.String()
		} else {
			return access.ErrUnauthenticated
		}
		session, _, err := s.sessionState(ctx, tx, id)
		if err != nil {
			return err
		}
		scope, err = access.NewScope(actorOf(session), session.ExpiresAt, s)
		if err != nil {
			return err
		}
		return tx.Model(&Session{}).Where("id = ? AND revoked_at IS NULL", session.ID).Update("last_seen_at", time.Now().UTC()).Error
	})
	return scope, err
}

// Restore validates persisted attribution before a queued target starts. It
// does not touch last_seen_at: background checks must not keep idle sessions alive.
func (s *Service) Restore(ctx context.Context, actor protocol.Actor) (access.Scope, error) {
	session, _, err := s.sessionState(ctx, s.db, actor.SessionID)
	if err != nil {
		return access.Scope{}, err
	}
	if actor != actorOf(session) {
		return access.Scope{}, access.ErrForbidden
	}
	return access.NewScope(actor, session.ExpiresAt, s)
}

func (s *Service) Context(ctx context.Context, scope access.Scope) (*protocol.AccessContext, error) {
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	if scope.Actor().Kind != protocol.Visitor {
		return nil, access.ErrForbidden
	}
	var result protocol.AccessContext
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		session, g, err := s.sessionState(ctx, tx, scope.Actor().SessionID)
		if err != nil {
			return err
		}
		resources, err := s.resourceViews(ctx, tx, g.ID)
		if err != nil {
			return err
		}
		result = contextOf(session, g, resources)
		return nil
	})
	return &result, err
}

func contextOf(session Session, g Grant, resources []protocol.AccessResource) protocol.AccessContext {
	return protocol.AccessContext{ProtocolVersion: protocol.AccessVersion, Actor: actorOf(session), GrantName: g.Name,
		DefaultContent: g.DefaultContent, ExpiresAt: session.ExpiresAt, MaxConnections: g.MaxConnections, Resources: resources}
}

func (s *Service) resourceViews(ctx context.Context, tx *gorm.DB, grantID uuid.UUID) ([]protocol.AccessResource, error) {
	var resources []Resource
	if err := tx.Where("grant_id = ?", grantID).Order("server_id").Find(&resources).Error; err != nil {
		return nil, err
	}
	views := make([]protocol.AccessResource, 0, len(resources))
	for _, resource := range resources {
		view, revision, err := s.catalog.Resource(ctx, tx, resource.ServerID)
		if err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, err
			}
			view = protocol.AccessResource{ID: resource.ServerID, Paused: true}
		}
		view.Paused = view.Paused || revision != resource.ApprovedConnectionRevision
		view.Actions = resource.Actions
		allowInteractive := resource.AllowInteractive
		view.AllowInteractive = &allowInteractive
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) VerifyBrowserCSRF(ctx context.Context, token, csrf string) error {
	var container BrowserContainer
	if token == "" || subtle.ConstantTimeCompare([]byte(csrfToken(token)), []byte(csrf)) != 1 {
		return access.ErrForbidden
	}
	if err := s.db.WithContext(ctx).Where("token_hash = ? AND expires_at > ?", digest(token), time.Now().UTC()).First(&container).Error; err != nil {
		return access.ErrUnauthenticated
	}
	return nil
}
