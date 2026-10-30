package auth

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
)

var _ access.Authorizer = (*ownerExecutionPolicy)(nil)

func (p *ownerExecutionPolicy) ServerIDs(ctx context.Context, actor protocol.Actor) ([]string, error) {
	return nil, p.Authorize(ctx, actor, access.Requirement{Action: protocol.WorkspaceRead})
}

func (p *ownerExecutionPolicy) AuthorizeInteractive(ctx context.Context, actor protocol.Actor, serverID string) error {
	return p.Authorize(ctx, actor, access.Requirement{Action: protocol.WorkspaceRead, ServerID: serverID})
}

func (p *ownerExecutionPolicy) Charge(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	if amount < 0 {
		return access.ErrForbidden
	}
	return p.Authorize(ctx, scope.Actor(), req)
}

func (p *ownerExecutionPolicy) CheckBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	if amount < 0 {
		return access.ErrForbidden
	}
	return p.Authorize(ctx, scope.Actor(), req)
}

func (p *ownerExecutionPolicy) ReserveBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int) (int, func(int) error, error) {
	if amount <= 0 {
		return 0, nil, access.ErrForbidden
	}
	if err := p.Authorize(ctx, scope.Actor(), req); err != nil {
		return 0, nil, err
	}
	return amount, nil, nil
}
