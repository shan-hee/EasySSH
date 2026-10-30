package grant

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/scriptutil"
	"net"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrInvalidLink    = errors.New("share link is invalid or unavailable")
	ErrPreparation    = errors.New("resource is not ready for sharing")
	ErrQuota          = errors.New("grant quota exhausted")
	ErrInvalidRequest = errors.New("invalid access request")
	ErrProtocol       = errors.New("unsupported access protocol version")
	ErrConflict       = errors.New("access state changed")
)

// Catalog reads the authoritative resource state in the caller's transaction.
// Ready verifies saved credentials and host trust without initiating SSH traffic.
type Catalog interface {
	Resource(context.Context, *gorm.DB, uuid.UUID) (protocol.AccessResource, int64, error)
	Ready(context.Context, *gorm.DB, uuid.UUID, bool) error
	ScriptVersion(context.Context, *gorm.DB, uuid.UUID) (string, error)
}

type Service struct {
	db        *gorm.DB
	catalog   Catalog
	runtime   *access.Runtime
	publicURL func(context.Context) (string, error)
	// This is a single-process service. The mutex serializes issuance, revocation
	// and idle reclamation; the database transaction makes each change durable.
	mu sync.Mutex
}

func NewService(db *gorm.DB, catalog Catalog, runtime *access.Runtime, publicURL func(context.Context) (string, error)) *Service {
	return &Service{db: db, catalog: catalog, runtime: runtime, publicURL: publicURL}
}

func randomSecret() (string, error) {
	var value [32]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value[:]), nil
}

func digest(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func matches(value, hash string) bool {
	return value != "" && subtle.ConstantTimeCompare([]byte(digest(value)), []byte(hash)) == 1
}

func publicOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("%w: configure a public instance origin", ErrPreparation)
	}
	loopback := u.Hostname() == "localhost"
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		loopback = ip.IsLoopback()
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return "", fmt.Errorf("%w: public instance origin must use HTTPS", ErrPreparation)
	}
	return u.Scheme + "://" + u.Host, nil
}

func normalizeRequest(req *protocol.CreateGrantInput, now time.Time) error {
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 100 || len(req.Resources) == 0 || len(req.Resources) > 100 {
		return invalidRequest("a grant needs a name and 1 to 100 explicit resources")
	}
	if req.DefaultContent == "" {
		req.DefaultContent = "terminal"
	}
	if _, ok := defaultActions[req.DefaultContent]; !ok {
		return invalidRequest("unsupported default content")
	}
	if req.LongLived && req.ExpiresAt != nil {
		return invalidRequest("long-lived grants cannot also specify expiry")
	}
	if req.ExpiresAt == nil && !req.LongLived {
		end := now.Add(24 * time.Hour)
		req.ExpiresAt = &end
	}
	if req.ExpiresAt != nil && !req.ExpiresAt.After(now) {
		return access.ErrExpired
	}
	if req.MaxSessions == 0 {
		req.MaxSessions = 3
	}
	if req.MaxConnections == 0 {
		req.MaxConnections = 4
	}
	if req.MaxSessions < 1 || req.MaxSessions > 100 || req.MaxConnections < 1 || req.MaxConnections > 100 {
		return invalidRequest("invalid concurrency limits")
	}
	for _, limit := range []*int64{req.UploadLimit, req.DownloadLimit, req.AIRequestLimit} {
		if limit != nil && *limit < 0 {
			return invalidRequest("quota must not be negative")
		}
	}
	seen := make(map[uuid.UUID]bool)
	for _, resource := range req.Resources {
		if resource.ServerID == uuid.Nil || seen[resource.ServerID] || len(resource.Actions) == 0 {
			return invalidRequest("invalid or repeated grant resource")
		}
		seen[resource.ServerID] = true
		actions := make(map[protocol.Action]bool)
		for _, action := range resource.Actions {
			if !action.Shareable() || actions[action] {
				return access.ErrForbidden
			}
			actions[action] = true
		}
		if !actions[defaultActions[req.DefaultContent]] {
			return invalidRequest("default content must be permitted on each resource")
		}
		if actions[protocol.AIUse] && req.AIRequestLimit == nil {
			return invalidRequest("visitor AI requires an explicit request quota")
		}
		if actions[protocol.ScriptsExecute] != (len(resource.Scripts) > 0) {
			return invalidRequest("script execution requires explicit script scopes")
		}
	}
	return nil
}

var defaultActions = map[string]protocol.Action{
	"terminal": protocol.TerminalConnect, "files": protocol.FilesList,
	"monitor": protocol.MonitorRead, "docker": protocol.DockerRead,
}

func (s *Service) Create(ctx context.Context, scope access.Scope, req protocol.CreateGrantInput) (*protocol.GrantCreated, error) {
	if err := scope.RequireOwner(ctx, protocol.GrantsManage); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if err := normalizeRequest(&req, now); err != nil {
		return nil, err
	}
	rawOrigin, err := s.publicURL(ctx)
	if err != nil {
		return nil, err
	}
	origin, err := publicOrigin(rawOrigin)
	if err != nil {
		return nil, err
	}
	secret, err := randomSecret()
	if err != nil {
		return nil, err
	}
	g := Grant{ID: uuid.New(), PublicID: uuid.NewString(), SecretHash: digest(secret), Name: req.Name,
		Version: 1, DefaultContent: req.DefaultContent, ExpiresAt: req.ExpiresAt,
		MaxSessions: req.MaxSessions, MaxConnections: req.MaxConnections,
		UploadLimit: req.UploadLimit, DownloadLimit: req.DownloadLimit, AIRequestLimit: req.AIRequestLimit,
		CreatedAt: now, UpdatedAt: now}
	s.mu.Lock()
	defer s.mu.Unlock()
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&g).Error; err != nil {
			return err
		}
		if err := s.writeResources(ctx, tx, g.ID, req.Resources, nil); err != nil {
			return err
		}
		return recordGrantConfiguration(tx, scope.Actor(), g, "grant_create", []string{"created"}, nil)
	})
	if err != nil {
		return nil, err
	}
	return &protocol.GrantCreated{Grant: g.Public(), Link: origin + "/share/" + g.PublicID + "#" + secret}, nil
}

func (s *Service) writeResources(ctx context.Context, tx *gorm.DB, grantID uuid.UUID, inputs []protocol.GrantResourceInput, approved map[uuid.UUID]int64) error {
	for _, input := range inputs {
		_, revision, err := s.catalog.Resource(ctx, tx, input.ServerID)
		if err != nil {
			return err
		}
		// Capture the approved revision before validating its dependencies. If
		// another transaction changes the target during preparation, the stored
		// revision cannot accidentally approve that new target.
		if err := s.catalog.Ready(ctx, tx, input.ServerID, input.AllowInteractive); err != nil {
			return fmt.Errorf("%w: %s: %v", ErrPreparation, input.ServerID, err)
		}
		if previous, ok := approved[input.ServerID]; ok {
			// Editing permissions must not silently reconfirm a changed target.
			revision = previous
		}
		r := Resource{GrantID: grantID, ServerID: input.ServerID, Actions: input.Actions,
			ApprovedConnectionRevision: revision, AllowInteractive: input.AllowInteractive}
		if err := tx.Create(&r).Error; err != nil {
			return err
		}
		seen := make(map[uuid.UUID]bool)
		for _, script := range input.Scripts {
			if script.ScriptID == uuid.Nil || seen[script.ScriptID] {
				return invalidRequest("invalid or repeated script scope")
			}
			seen[script.ScriptID] = true
			version, err := s.catalog.ScriptVersion(ctx, tx, script.ScriptID)
			if err != nil {
				return err
			}
			if script.Version != version {
				return access.ErrResourceChanged
			}
			if err := scriptutil.ValidateParameterRules(script.Parameters); err != nil {
				return invalidRequest("invalid script parameter rules")
			}
			if script.Parameters == nil {
				script.Parameters = map[string]protocol.GrantParameterRule{}
			}
			row := ScriptScope{GrantID: grantID, ServerID: input.ServerID, ScriptID: script.ScriptID, Version: script.Version, Parameters: script.Parameters}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func activeGrant(g Grant, now time.Time) error {
	if g.RevokedAt != nil {
		return access.ErrRevoked
	}
	if g.ExpiresAt != nil && !now.Before(*g.ExpiresAt) {
		return access.ErrExpired
	}
	return nil
}

func (s *Service) sessionState(ctx context.Context, db *gorm.DB, id string) (Session, Grant, error) {
	var session Session
	var g Grant
	if err := db.WithContext(ctx).Where("id = ?", id).First(&session).Error; err != nil {
		return session, g, access.ErrUnauthenticated
	}
	now := time.Now().UTC()
	if session.RevokedAt != nil {
		return session, g, access.ErrRevoked
	}
	if !now.Before(session.ExpiresAt) {
		return session, g, access.ErrExpired
	}
	if !session.LastSeenAt.Add(idleLifetime).After(now) && !s.runtime.Busy(session.ID.String()) {
		return session, g, access.ErrExpired
	}
	if err := db.WithContext(ctx).Where("id = ?", session.GrantID).First(&g).Error; err != nil {
		return session, g, access.ErrUnauthenticated
	}
	if err := activeGrant(g, now); err != nil {
		return session, g, err
	}
	if session.GrantVersion != g.Version {
		return session, g, access.ErrRevoked
	}
	return session, g, nil
}

func actorOf(session Session) protocol.Actor {
	return protocol.Actor{Kind: protocol.Visitor, ID: session.ID.String(), SessionID: session.ID.String(), GrantID: session.GrantID.String()}
}

func (s *Service) Authorize(ctx context.Context, actor protocol.Actor, req access.Requirement) error {
	if actor.Kind != protocol.Visitor || !actor.Valid() {
		return access.ErrForbidden
	}
	session, g, err := s.sessionState(ctx, s.db, actor.SessionID)
	if err != nil {
		return err
	}
	if actor != actorOf(session) {
		return access.ErrForbidden
	}
	if req.Action == protocol.WorkspaceRead && req.ServerID == "" || req.Action == protocol.ActivityRead {
		// Callers must filter results by the exact access session, not the grant.
		return nil
	}
	if !req.Action.Shareable() && req.Action != protocol.WorkspaceRead || req.ServerID == "" {
		return access.ErrForbidden
	}
	var resource Resource
	if err := s.db.WithContext(ctx).Where("grant_id = ? AND server_id = ?", g.ID, req.ServerID).First(&resource).Error; err != nil {
		return access.ErrForbidden
	}
	if req.Action != protocol.WorkspaceRead && !slices.Contains(resource.Actions, req.Action) {
		return access.ErrForbidden
	}
	_, revision, err := s.catalog.Resource(ctx, s.db, resource.ServerID)
	if err != nil || revision != resource.ApprovedConnectionRevision {
		return access.ErrResourceChanged
	}
	if req.Action == protocol.ScriptsExecute {
		var script ScriptScope
		if req.ScriptID == "" || req.ScriptVersion == "" {
			return access.ErrForbidden
		}
		if err := s.db.WithContext(ctx).Where("grant_id = ? AND server_id = ? AND script_id = ?", g.ID, resource.ServerID, req.ScriptID).First(&script).Error; err != nil {
			return access.ErrForbidden
		}
		current, err := s.catalog.ScriptVersion(ctx, s.db, script.ScriptID)
		if err != nil || current != script.Version || current != req.ScriptVersion {
			return access.ErrResourceChanged
		}
	}
	return nil
}

// CheckScript must be called with the final parameters, before every attempt.
func (s *Service) CheckScript(ctx context.Context, scope access.Scope, req access.Requirement, parameters map[string]string) error {
	if req.Action != protocol.ScriptsExecute {
		return access.ErrForbidden
	}
	if err := scope.Check(ctx, req); err != nil {
		return err
	}
	if scope.IsOwner() {
		return nil
	}
	var script ScriptScope
	if err := s.db.WithContext(ctx).Where("grant_id = ? AND server_id = ? AND script_id = ?", scope.Actor().GrantID, req.ServerID, req.ScriptID).First(&script).Error; err != nil {
		return access.ErrForbidden
	}
	for name, value := range parameters {
		rule, ok := script.Parameters[name]
		if !ok || len(value) > rule.MaxBytes || len(rule.Values) > 0 && !slices.Contains(rule.Values, value) {
			return access.ErrForbidden
		}
	}
	for name, rule := range script.Parameters {
		if rule.Required && parameters[name] == "" {
			return access.ErrForbidden
		}
	}
	return nil
}

func invalidRequest(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidRequest, message)
}

func (s *Service) ServerIDs(ctx context.Context, actor protocol.Actor) ([]string, error) {
	if err := s.Authorize(ctx, actor, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	ids := []string{}
	err := s.db.WithContext(ctx).Table("grant_resources AS r").Select("r.server_id").Joins("JOIN servers AS s ON s.id=r.server_id AND s.connection_revision=r.approved_connection_revision").Where("r.grant_id=? AND s.deleted_at IS NULL", actor.GrantID).Scan(&ids).Error
	return ids, err
}

func (s *Service) ScriptParameters(ctx context.Context, scope access.Scope, req access.Requirement) (map[string]protocol.GrantParameterRule, error) {
	if req.Action != protocol.ScriptsExecute {
		return nil, access.ErrForbidden
	}
	if err := scope.Check(ctx, req); err != nil {
		return nil, err
	}
	if scope.IsOwner() {
		return map[string]protocol.GrantParameterRule{}, nil
	}
	var rule ScriptScope
	if err := s.db.WithContext(ctx).Where("grant_id = ? AND server_id = ? AND script_id = ?", scope.Actor().GrantID, req.ServerID, req.ScriptID).First(&rule).Error; err != nil {
		return nil, access.ErrForbidden
	}
	return rule.Parameters, nil
}
