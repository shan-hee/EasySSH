package rest

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func requireCurrentUserID(c *gin.Context) (uuid.UUID, bool) {
	value, exists := c.Get("user_id")
	if !exists {
		RespondError(c, http.StatusUnauthorized, "unauthorized", "user_id not found")
		return uuid.Nil, false
	}

	userID, ok := value.(string)
	if !ok {
		RespondError(c, http.StatusBadRequest, "invalid_user_id", "invalid user ID format")
		return uuid.Nil, false
	}

	parsed, err := uuid.Parse(userID)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_user_id", err.Error())
		return uuid.Nil, false
	}

	return parsed, true
}
