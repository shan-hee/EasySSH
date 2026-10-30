package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"github.com/easyssh/shared/protocol"
	"slices"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrInvalidTicket = errors.New("invalid ticket")
	ErrExpiredTicket = errors.New("expired ticket")
	ErrTicketUsed    = errors.New("ticket already used")
)

type TicketType string

const (
	TicketTypeTransferArtifact       TicketType = "transfer_artifact"
	TicketTypeWSTerminal             TicketType = "ws_terminal"
	TicketTypeWSMonitor              TicketType = "ws_monitor"
	TicketTypeWSSFTPAuth             TicketType = "ws_sftp_auth"
	TicketTypeInstanceBackupDownload TicketType = "instance_backup_download"
)

func (t TicketType) IsValid() bool {
	switch t {
	case TicketTypeTransferArtifact, TicketTypeWSTerminal, TicketTypeWSMonitor, TicketTypeWSSFTPAuth,
		TicketTypeInstanceBackupDownload:
		return true
	default:
		return false
	}
}

type Ticket struct {
	ConnectionID string
	Actor        protocol.Actor
	Scope        access.Scope
	Requirements []access.Requirement
	Value        string
	Type         TicketType
	Ref          string
	CreatedAt    time.Time
	ExpiresAt    time.Time
	UsedAt       *time.Time
}

type TicketRecord struct {
	ConnectionID string               `gorm:"size:32"`
	ActorKind    protocol.Kind        `gorm:"size:32;not null"`
	ActorID      string               `gorm:"size:36;not null"`
	SessionID    string               `gorm:"size:36;not null"`
	GrantID      string               `gorm:"size:36"`
	Requirements []access.Requirement `gorm:"serializer:json;type:text;not null"`
	ID           uuid.UUID            `gorm:"type:char(36);primaryKey"`
	TokenHash    string               `gorm:"not null;uniqueIndex;size:64"`
	Type         TicketType           `gorm:"not null;size:40"`
	Ref          string               `gorm:"size:255"`
	CreatedAt    time.Time
	ExpiresAt    time.Time `gorm:"not null"`
	UsedAt       *time.Time
}

func (TicketRecord) TableName() string { return "auth_tickets" }

func (r *TicketRecord) BeforeCreate(*gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

type CreateTicketRequest struct {
	ConnectionID string
	Scope        access.Scope
	Type         TicketType
	Ref          string
}

type TicketExpectation struct {
	Type TicketType
	Ref  string
}

type WorkTicketResolver func(context.Context, access.Scope, string) ([]access.Requirement, error)

type TicketService interface {
	RegisterWorkResolver(TicketType, WorkTicketResolver) error
	Create(ctx context.Context, req CreateTicketRequest) (ticket string, expiresInSeconds int, err error)
	Consume(ctx context.Context, ticket string, expect TicketExpectation) (*Ticket, error)
}

type TicketConfig struct{ TTL time.Duration }

type ticketService struct {
	resolverMu sync.RWMutex
	resolvers  map[TicketType]WorkTicketResolver
	runtime    *access.Runtime
	restore    func(context.Context, protocol.Actor) (access.Scope, error)
	db         *gorm.DB
	ttl        time.Duration
}

func NewTicketService(db *gorm.DB, cfg TicketConfig, runtime *access.Runtime, restore func(context.Context, protocol.Actor) (access.Scope, error)) TicketService {
	if cfg.TTL <= 0 {
		cfg.TTL = 30 * time.Second
	}
	return &ticketService{resolvers: make(map[TicketType]WorkTicketResolver), db: db, ttl: cfg.TTL, runtime: runtime, restore: restore}
}

func (s *ticketService) Create(ctx context.Context, req CreateTicketRequest) (string, int, error) {
	if !req.Type.IsValid() || req.Ref == "" {
		return "", 0, ErrInvalidTicket
	}
	requirements, err := s.requirements(ctx, req.Scope, req.Type, req.Ref)
	if err != nil {
		return "", 0, err
	}
	if ticketUsesConnection(req.Type) {
		if _, err := s.runtime.Connection(ctx, req.Scope, req.ConnectionID, req.Ref); err != nil {
			return "", 0, err
		}
	} else if req.ConnectionID != "" {
		return "", 0, ErrInvalidTicket
	}
	value, err := newRandomTicketValue(32)
	if err != nil {
		return "", 0, err
	}

	now := time.Now().UTC()
	expires := now.Add(s.ttl)
	if req.Scope.ExpiresAt().Before(expires) {
		expires = req.Scope.ExpiresAt()
	}
	actor := req.Scope.Actor()
	record := &TicketRecord{
		ConnectionID: req.ConnectionID, TokenHash: ticketHash(value), Type: req.Type, Ref: req.Ref,
		ActorKind: actor.Kind, ActorID: actor.ID, SessionID: actor.SessionID, GrantID: actor.GrantID, Requirements: requirements,
		CreatedAt: now, ExpiresAt: expires,
	}
	if err := s.db.WithContext(ctx).Create(record).Error; err != nil {
		return "", 0, err
	}
	return value, int(expires.Sub(now).Seconds()), nil
}

func (s *ticketService) Consume(ctx context.Context, value string, expect TicketExpectation) (*Ticket, error) {
	if value == "" || !expect.Type.IsValid() {
		return nil, ErrInvalidTicket
	}
	var record TicketRecord
	if err := s.db.WithContext(ctx).Where("token_hash = ?", ticketHash(value)).First(&record).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidTicket
		}
		return nil, err
	}
	if record.UsedAt != nil {
		return nil, ErrTicketUsed
	}
	if time.Now().After(record.ExpiresAt) {
		return nil, ErrExpiredTicket
	}
	if record.Type != expect.Type || expect.Ref != "" && record.Ref != expect.Ref {
		return nil, ErrInvalidTicket
	}
	actor := protocol.Actor{Kind: record.ActorKind, ID: record.ActorID, SessionID: record.SessionID, GrantID: record.GrantID}
	scope, err := s.restore(ctx, actor)
	if err != nil {
		return nil, err
	}
	current, err := s.requirements(ctx, scope, record.Type, record.Ref)
	if err != nil {
		return nil, err
	}
	if !slices.Equal(current, record.Requirements) {
		return nil, ErrInvalidTicket
	}
	for _, requirement := range record.Requirements {
		if err := scope.Check(ctx, requirement); err != nil {
			return nil, err
		}
	}
	if ticketUsesConnection(record.Type) {
		if _, err := s.runtime.Connection(ctx, scope, record.ConnectionID, record.Ref); err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC()
	result := s.db.WithContext(ctx).Model(&TicketRecord{}).
		Where("id = ? AND used_at IS NULL AND expires_at > ?", record.ID, now).Update("used_at", now)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrTicketUsed
	}

	return &Ticket{
		ConnectionID: record.ConnectionID, Value: value, Type: record.Type, Ref: record.Ref,
		Actor: actor, Scope: scope, Requirements: record.Requirements,
		CreatedAt: record.CreatedAt, ExpiresAt: record.ExpiresAt, UsedAt: &now,
	}, nil
}

func newRandomTicketValue(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func ticketHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func ticketRequirements(ctx context.Context, scope access.Scope, kind TicketType, ref string) ([]access.Requirement, error) {
	req := access.Requirement{ServerID: ref}
	switch kind {
	case TicketTypeWSTerminal:
		req.Action = protocol.TerminalConnect
	case TicketTypeWSMonitor:
		req.Action = protocol.MonitorRead
	case TicketTypeWSSFTPAuth:
		req.Action = protocol.FilesList
	case TicketTypeInstanceBackupDownload:
		req = access.Requirement{Action: protocol.BackupManage}
		if err := scope.RequireOwner(ctx, protocol.BackupManage); err != nil {
			return nil, err
		}
	case TicketTypeTransferArtifact:
		// Task tickets require a host-registered resolver; a generic workspace
		// check cannot prove ownership or identify the execution resources.
		return nil, ErrInvalidTicket
	default:
		return nil, ErrInvalidTicket
	}
	if err := scope.Check(ctx, req); err != nil {
		return nil, err
	}
	return []access.Requirement{req}, nil
}

func ticketUsesConnection(kind TicketType) bool {
	switch kind {
	case TicketTypeWSTerminal, TicketTypeWSMonitor, TicketTypeWSSFTPAuth:
		return true
	default:
		return false
	}
}

// RegisterWorkResolver is called during host assembly. A task reference never
// acts as authorization; both issuance and consumption resolve its actual owner
// and execution resources again.
func (s *ticketService) RegisterWorkResolver(kind TicketType, resolver WorkTicketResolver) error {
	if resolver == nil || kind != TicketTypeTransferArtifact {
		return ErrInvalidTicket
	}
	s.resolverMu.Lock()
	defer s.resolverMu.Unlock()
	if s.resolvers[kind] != nil {
		return errors.New("work ticket resolver already registered")
	}
	s.resolvers[kind] = resolver
	return nil
}
func (s *ticketService) requirements(ctx context.Context, scope access.Scope, kind TicketType, ref string) ([]access.Requirement, error) {
	s.resolverMu.RLock()
	resolver := s.resolvers[kind]
	s.resolverMu.RUnlock()
	if resolver == nil {
		return ticketRequirements(ctx, scope, kind, ref)
	}
	requirements, err := resolver(ctx, scope, ref)
	if err != nil {
		return nil, err
	}
	if len(requirements) == 0 {
		return nil, ErrInvalidTicket
	}
	for _, req := range requirements {
		if err := scope.Check(ctx, req); err != nil {
			return nil, err
		}
	}
	return requirements, nil
}
