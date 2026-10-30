package auth

import (
	"context"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

// OwnerExecutionScope is only issued by the scheduler or durable job dispatcher.
// It represents the owner, without minting a login session or a reusable token.
// Executors check their persisted definition and resource version at each stage.
func (s *Service) OwnerExecutionScope(ctx context.Context, ownerID uuid.UUID) (access.Scope, error) {
	var owner Owner
	if ownerID == uuid.Nil {
		return access.Scope{}, access.ErrForbidden
	}
	if err := s.db.WithContext(ctx).Select("id").Where("id=? AND slot=1", ownerID).First(&owner).Error; err != nil {
		return access.Scope{}, err
	}
	actor := protocol.Actor{Kind: protocol.Owner, ID: owner.ID.String()}
	return access.NewScope(actor, time.Now().Add(24*time.Hour), &ownerExecutionPolicy{actor: actor, runtime: s.runtime})
}

type ownerExecutionPolicy struct {
	actor   protocol.Actor
	runtime *access.Runtime
}

func (p *ownerExecutionPolicy) Authorize(ctx context.Context, actor protocol.Actor, req access.Requirement) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if actor != p.actor {
		return access.ErrForbidden
	}
	switch req.Action {
	case protocol.WorkspaceRead, protocol.TerminalConnect, protocol.ScriptsExecute, protocol.FilesUpload, protocol.FilesDownload:
		return nil
	default:
		return access.ErrForbidden
	}
}

func (p *ownerExecutionPolicy) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	if scope.Actor() != p.actor {
		return nil, access.ErrForbidden
	}
	return p.runtime.Reserve(ctx, scope, kind, 0, requirements...)
}
