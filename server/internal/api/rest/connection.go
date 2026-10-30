package rest

import (
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
)

type ConnectionHandler struct{ runtime *access.Runtime }

func NewConnectionHandler(runtime *access.Runtime) *ConnectionHandler {
	return &ConnectionHandler{runtime: runtime}
}
func (h *ConnectionHandler) Create(c *gin.Context) {
	var req protocol.CreateConnectionInput
	if !accessBody(c, &req) {
		return
	}
	id, err := uuid.Parse(req.ServerID)
	if err != nil || id == uuid.Nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_server_id"})
		return
	}
	result, err := h.runtime.CreateConnection(c.Request.Context(), access.Current(c.Request.Context()), id.String(), req.Mode)
	if err != nil {
		accessError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusCreated, result)
}
func (h *ConnectionHandler) Heartbeat(c *gin.Context) {
	connection, err := h.runtime.Connection(c.Request.Context(), access.Current(c.Request.Context()), c.Param("id"), "")
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusOK, connection.Info())
}
func (h *ConnectionHandler) Close(c *gin.Context) {
	connection, err := h.runtime.Connection(c.Request.Context(), access.Current(c.Request.Context()), c.Param("id"), "")
	if err != nil {
		accessError(c, err)
		return
	}
	connection.Close()
	c.Status(http.StatusNoContent)
}
