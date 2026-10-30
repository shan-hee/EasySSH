package grant

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"github.com/easyssh/shared/protocol"
	"strings"
	"time"
	"unicode"

	"github.com/easyssh/server/internal/access"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Handoff has no redirect URL and carries no share secret. The receiver binds a
// verifier before the initiating browser explicitly approves that receiver.
type Handoff struct {
	ID              uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	SourceSessionID uuid.UUID  `gorm:"type:char(36);not null" json:"-"`
	ReceiverHash    string     `gorm:"size:64;not null" json:"-"`
	ReceiverName    string     `gorm:"size:100;not null" json:"receiver_name"`
	CreatedAt       time.Time  `json:"created_at"`
	ExpiresAt       time.Time  `json:"expires_at"`
	ApprovedAt      *time.Time `json:"approved_at"`
	ConsumedAt      *time.Time `json:"consumed_at"`
}

func (Handoff) TableName() string { return "access_handoffs" }

func handoffView(h Handoff) protocol.AccessHandoff {
	confirmation := ""
	if len(h.ReceiverHash) == 64 {
		confirmation = strings.ToUpper(h.ReceiverHash[:8])
	}
	return protocol.AccessHandoff{ID: h.ID, ReceiverName: h.ReceiverName, Confirmation: confirmation,
		ExpiresAt: h.ExpiresAt, ApprovedAt: h.ApprovedAt, ConsumedAt: h.ConsumedAt}
}

func (s *Service) CreateHandoff(ctx context.Context, scope access.Scope) (*protocol.AccessHandoff, error) {
	if scope.Actor().Kind != protocol.Visitor {
		return nil, access.ErrForbidden
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	session, _, err := s.sessionState(ctx, s.db, scope.Actor().SessionID)
	if err != nil {
		return nil, err
	}
	if session.ClientKind != "browser" {
		return nil, access.ErrForbidden
	}
	now := time.Now().UTC()
	h := Handoff{ID: uuid.New(), SourceSessionID: session.ID, CreatedAt: now, ExpiresAt: now.Add(2 * time.Minute)}
	if session.ExpiresAt.Before(h.ExpiresAt) {
		h.ExpiresAt = session.ExpiresAt
	}
	if err := s.db.WithContext(ctx).Create(&h).Error; err != nil {
		return nil, err
	}
	view := handoffView(h)
	return &view, nil
}

func liveHandoff(tx *gorm.DB, id uuid.UUID) (Handoff, error) {
	var h Handoff
	if err := tx.Where("id = ? AND expires_at > ? AND consumed_at IS NULL", id, time.Now().UTC()).First(&h).Error; err != nil {
		return h, ErrInvalidLink
	}
	return h, nil
}

func (s *Service) BindHandoff(ctx context.Context, id uuid.UUID, challenge, name string) (*protocol.AccessHandoff, error) {
	decoded, err := hex.DecodeString(challenge)
	if err != nil || len(decoded) != 32 || strings.ToLower(challenge) != challenge {
		return nil, invalidRequest("receiver challenge must be a SHA-256 digest")
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return nil, invalidRequest("invalid receiver name")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var result protocol.AccessHandoff
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		h, err := liveHandoff(tx, id)
		if err != nil {
			return err
		}
		if _, _, err := s.sessionState(ctx, tx, h.SourceSessionID.String()); err != nil {
			return err
		}
		if h.ReceiverHash != "" || h.ApprovedAt != nil {
			return ErrConflict
		}
		h.ReceiverHash, h.ReceiverName = challenge, name
		if err := tx.Save(&h).Error; err != nil {
			return err
		}
		result = handoffView(h)
		return nil
	})
	return &result, err
}

func (s *Service) HandoffStatus(ctx context.Context, scope access.Scope, id uuid.UUID) (*protocol.AccessHandoff, error) {
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	var h Handoff
	if scope.Actor().Kind != protocol.Visitor {
		return nil, access.ErrForbidden
	}
	if err := s.db.WithContext(ctx).Where("id = ? AND source_session_id = ?", id, scope.Actor().SessionID).First(&h).Error; err != nil {
		return nil, ErrInvalidLink
	}
	result := handoffView(h)
	return &result, nil
}

func (s *Service) ApproveHandoff(ctx context.Context, scope access.Scope, id uuid.UUID, confirmation string) error {
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return err
	}
	if scope.Actor().Kind != protocol.Visitor {
		return access.ErrForbidden
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		h, err := liveHandoff(tx, id)
		if err != nil {
			return err
		}
		if h.SourceSessionID.String() != scope.Actor().SessionID || h.ReceiverHash == "" || confirmation != handoffView(h).Confirmation {
			return access.ErrForbidden
		}
		if _, _, err := s.sessionState(ctx, tx, h.SourceSessionID.String()); err != nil {
			return err
		}
		return tx.Model(&h).Update("approved_at", time.Now().UTC()).Error
	})
}

func (s *Service) ClaimHandoff(ctx context.Context, id uuid.UUID, verifier string, protocolMin, protocolMax int) (*ExchangeResult, error) {
	if protocolMin < 1 || protocolMin > ProtocolVersion || protocolMax < ProtocolVersion || protocolMax < protocolMin {
		return nil, ErrProtocol
	}
	bytes, err := base64.RawURLEncoding.DecodeString(verifier)
	if err != nil || len(bytes) != 32 {
		return nil, ErrInvalidLink
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var result ExchangeResult
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		h, err := liveHandoff(tx, id)
		if err != nil {
			return err
		}
		if h.ApprovedAt == nil || !matches(verifier, h.ReceiverHash) {
			return ErrInvalidLink
		}
		_, g, err := s.sessionState(ctx, tx, h.SourceSessionID.String())
		if err != nil {
			return err
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
			return access.ErrResourceChanged
		}
		now := time.Now().UTC()
		if err := s.reclaimIdle(tx, g.ID, now); err != nil {
			return err
		}
		session, token, err := s.issueSession(tx, g, "desktop", nil, now)
		if err != nil {
			return err
		}
		consumed := tx.Model(&Handoff{}).Where("id = ? AND consumed_at IS NULL AND expires_at > ?", id, now).Update("consumed_at", now)
		if consumed.Error != nil {
			return consumed.Error
		}
		if consumed.RowsAffected != 1 {
			return ErrInvalidLink
		}
		result.Context, result.SessionToken = contextOf(session, g, resources), token
		return nil
	})
	return &result, err
}
