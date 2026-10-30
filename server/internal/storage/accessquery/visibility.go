// Package accessquery applies the authenticated activity audience at the SQL
// boundary, before pagination, aggregates or individual-object reads.
package accessquery

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"gorm.io/gorm"
)

func Visible(ctx context.Context, query *gorm.DB) (*gorm.DB, error) {
	scope := access.Current(ctx)
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	if scope.RequireOwner(ctx, protocol.ActivityRead) == nil {
		return query, nil
	}
	actor := scope.Actor()
	if actor.Kind != protocol.Visitor && actor.Kind != protocol.Owner {
		return nil, access.ErrForbidden
	}
	return query.Where("actor_kind = ? AND actor_id = ? AND actor_session_id = ? AND actor_grant_id = ?", actor.Kind, actor.ID, actor.SessionID, actor.GrantID), nil
}
