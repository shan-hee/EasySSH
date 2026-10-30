package auth

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
)

var _ access.Authorizer = (*Service)(nil)

func (s *Service) ServerIDs(ctx context.Context, actor protocol.Actor) ([]string, error) {
	return nil, s.Authorize(ctx, actor, access.Requirement{Action: protocol.WorkspaceRead})
}

func (s *Service) AuthorizeInteractive(ctx context.Context, actor protocol.Actor, serverID string) error {
	return s.Authorize(ctx, actor, access.Requirement{Action: protocol.WorkspaceRead, ServerID: serverID})
}

func (s *Service) Charge(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	if amount < 0 {
		return access.ErrForbidden
	}
	return s.Authorize(ctx, scope.Actor(), req)
}

func (s *Service) CheckBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	if amount < 0 {
		return access.ErrForbidden
	}
	return s.Authorize(ctx, scope.Actor(), req)
}

func (s *Service) ReserveBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int) (int, func(int) error, error) {
	if amount <= 0 {
		return 0, nil, access.ErrForbidden
	}
	if err := s.Authorize(ctx, scope.Actor(), req); err != nil {
		return 0, nil, err
	}
	return amount, nil, nil
}
