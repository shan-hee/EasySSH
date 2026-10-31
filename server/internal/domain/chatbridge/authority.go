package chatbridge

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
)

// A binding delegates only AI tools on explicitly selected resources. It is not
// an HTTP login or a machine token. The owner can inspect its history in the web UI.
type bindingPolicy struct {
	revision     int64
	service      *Service
	actor        protocol.Actor
	connectionID string
	mode         string
}

var _ access.Authorizer = (*bindingPolicy)(nil)

func (s *Service) bindingContext(ctx context.Context, c Connection, b Binding) (context.Context, error) {
	actor := protocol.Actor{Kind: protocol.Owner, ID: c.OwnerID, SessionID: b.ID}
	p := &bindingPolicy{service: s, actor: actor, connectionID: c.ID, mode: c.PermissionMode, revision: c.Revision}
	scope, err := access.NewScope(actor, time.Now().Add(24*time.Hour), p)
	if err != nil {
		return nil, err
	}
	ctx = access.WithScope(ctx, scope)
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	return ctx, nil
}

func (p *bindingPolicy) current(ctx context.Context, actor protocol.Actor) (Connection, []string, error) {
	if actor != p.actor {
		return Connection{}, nil, access.ErrForbidden
	}
	var c Connection
	// Join on the persistent binding each time. Revocation/config changes affect
	// future tool calls even when the AI run detached from its incoming request.
	err := p.service.db.WithContext(ctx).Table("chat_connections AS c").Select("c.*").
		Joins("JOIN chat_bindings AS b ON b.connection_id = c.id").
		Joins("JOIN owners AS o ON o.id = c.owner_id").
		Where("c.id = ? AND c.owner_id = ? AND c.enabled = ? AND c.revision = ? AND b.id = ? AND b.revoked_at IS NULL", p.connectionID, actor.ID, true, p.revision, actor.SessionID).
		Take(&c).Error
	if err != nil {
		return Connection{}, nil, access.ErrRevoked
	}
	var ids []string
	if err := json.Unmarshal([]byte(c.ServerIDsJSON), &ids); err != nil || len(ids) == 0 {
		return Connection{}, nil, access.ErrForbidden
	}
	return c, ids, nil
}

func (p *bindingPolicy) Authorize(ctx context.Context, actor protocol.Actor, req access.Requirement) error {
	c, ids, err := p.current(ctx, actor)
	if err != nil {
		return err
	}
	if req.ServerID != "" && !slices.Contains(ids, req.ServerID) {
		return access.ErrForbidden
	}
	switch req.Action {
	case protocol.OwnerManage: // Required by the runtime's owner admission, not exposed as an HTTP scope.
		if req.ServerID == "" {
			return nil
		}
	case protocol.WorkspaceRead:
		return nil
	case protocol.AIUse, protocol.FilesList, protocol.FilesRead, protocol.MonitorRead:
		if req.ServerID != "" {
			return nil
		}
	case protocol.TerminalConnect, protocol.FilesWrite, protocol.FilesDelete:
		if req.ServerID != "" && c.PermissionMode == "balanced" && p.mode == "balanced" {
			return nil
		}
	}
	return access.ErrForbidden
}

func (p *bindingPolicy) ServerIDs(ctx context.Context, actor protocol.Actor) ([]string, error) {
	_, ids, err := p.current(ctx, actor)
	return ids, err
}
func (p *bindingPolicy) AuthorizeInteractive(context.Context, protocol.Actor, string) error {
	return access.ErrForbidden
}
func (p *bindingPolicy) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, reqs ...access.Requirement) (*access.Lease, error) {
	if scope.Actor() != p.actor {
		return nil, access.ErrForbidden
	}
	return p.service.accessRuntime.Reserve(ctx, scope, kind, 0, reqs...)
}
func (p *bindingPolicy) Charge(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	if amount < 0 {
		return access.ErrForbidden
	}
	return p.Authorize(ctx, scope.Actor(), req)
}
func (p *bindingPolicy) CheckBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	return p.Charge(ctx, scope, req, amount)
}
func (p *bindingPolicy) ReserveBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int) (int, func(int) error, error) {
	if amount <= 0 {
		return 0, nil, access.ErrForbidden
	}
	if err := p.Authorize(ctx, scope.Actor(), req); err != nil {
		return 0, nil, err
	}
	return amount, nil, nil
}
