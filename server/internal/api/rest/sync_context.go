package rest

import (
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func requireSyncOwnerID(c *gin.Context) (uuid.UUID, bool) {
	scope, ok := currentAccess(c)
	if !ok {
		return uuid.Nil, false
	}
	if scope.Actor().Kind != protocol.Owner && scope.Actor().Kind != protocol.Device {
		accessError(c, access.ErrForbidden)
		return uuid.Nil, false
	}
	if err := scope.Check(c.Request.Context(), access.Requirement{Action: protocol.SyncRead}); err != nil {
		accessError(c, err)
		return uuid.Nil, false
	}
	id, err := uuid.Parse(scope.Actor().ID)
	if err != nil {
		accessError(c, access.ErrUnauthenticated)
		return uuid.Nil, false
	}
	return id, true
}
