package rest

import (
	"github.com/easyssh/server/internal/api/middleware"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func requireCurrentOwnerID(c *gin.Context) (uuid.UUID, bool) {
	value, exists := middleware.OwnerIdentity(c)
	if !exists {
		RespondError(c, http.StatusUnauthorized, "unauthorized", "owner_id not found")
		return uuid.Nil, false
	}

	ownerID, ok := value.(string)
	if !ok {
		RespondError(c, http.StatusBadRequest, "invalid_owner_id", "invalid owner ID format")
		return uuid.Nil, false
	}

	parsed, err := uuid.Parse(ownerID)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_owner_id", err.Error())
		return uuid.Nil, false
	}

	return parsed, true
}
