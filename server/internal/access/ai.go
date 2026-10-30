package access

import (
	"context"
	"github.com/easyssh/shared/protocol"
)

// RequireAIActor applies the same AI admission policy to execution and stored history.
func RequireAIActor(ctx context.Context) (protocol.Actor, error) {
	scope := Current(ctx)
	if scope.RequireOwner(ctx, protocol.OwnerManage) == nil {
		return scope.Actor(), nil
	}
	if scope.Actor().Kind != protocol.Visitor {
		return protocol.Actor{}, ErrForbidden
	}
	ids, err := scope.ServerIDs(ctx)
	if err != nil {
		return protocol.Actor{}, err
	}
	for _, id := range ids {
		if err := scope.Check(ctx, Requirement{Action: protocol.AIUse, ServerID: id}); err == nil {
			return scope.Actor(), nil
		}
	}
	return protocol.Actor{}, ErrForbidden
}
