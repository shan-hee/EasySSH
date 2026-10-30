package grant

import (
	"context"
	"github.com/easyssh/shared/protocol"

	"github.com/easyssh/server/internal/access"
)

// OpenWork is the only visitor entry into the runtime. The connection limit
// comes from persisted policy, never from a caller-supplied number.
func (s *Service) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	if scope.Actor().Kind != protocol.Visitor {
		return nil, access.ErrForbidden
	}
	session, g, err := s.sessionState(ctx, s.db, scope.Actor().SessionID)
	if err != nil {
		return nil, err
	}
	if actorOf(session) != scope.Actor() {
		return nil, access.ErrForbidden
	}
	// Use an issued scope with the current authoritative expiry for resumed work.
	fresh, err := access.NewScope(actorOf(session), session.ExpiresAt, s)
	if err != nil {
		return nil, err
	}
	return s.runtime.Reserve(ctx, fresh, kind, g.MaxConnections, requirements...)
}

func (s *Service) AuthorizeInteractive(ctx context.Context, actor protocol.Actor, serverID string) error {
	if err := s.Authorize(ctx, actor, access.Requirement{Action: protocol.WorkspaceRead, ServerID: serverID}); err != nil {
		return err
	}
	var resource Resource
	if err := s.db.WithContext(ctx).Where("grant_id = ? AND server_id = ?", actor.GrantID, serverID).First(&resource).Error; err != nil {
		return access.ErrForbidden
	}
	if !resource.AllowInteractive {
		return access.ErrForbidden
	}
	return nil
}

var _ access.Authorizer = (*Service)(nil)
