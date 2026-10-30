package datasync

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
)

var _ access.Authorizer = (*Service)(nil)

func (s *Service) ServerIDs(ctx context.Context, actor protocol.Actor) ([]string, error) {
	return nil, access.ErrForbidden
}

func (s *Service) AuthorizeInteractive(ctx context.Context, actor protocol.Actor, serverID string) error {
	return access.ErrForbidden
}

func (s *Service) Charge(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	return access.ErrForbidden
}

func (s *Service) CheckBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	return access.ErrForbidden
}

func (s *Service) ReserveBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int) (int, func(int) error, error) {
	return 0, nil, access.ErrForbidden
}

func (s *Service) OpenWork(context.Context, access.Scope, access.WorkKind, ...access.Requirement) (*access.Lease, error) {
	return nil, access.ErrForbidden
}
