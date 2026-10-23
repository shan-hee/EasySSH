package rest

import (
	"context"
	"net/http"
	"time"

	"github.com/easyssh/server/internal/domain/monitor"
	"github.com/easyssh/shared/systeminfo"
	"github.com/gin-gonic/gin"
)

type SystemInfoHandler struct{ pool *monitor.ConnectionPool }

func NewSystemInfoHandler(pool *monitor.ConnectionPool) *SystemInfoHandler {
	return &SystemInfoHandler{pool: pool}
}

func (h *SystemInfoHandler) Snapshot(c *gin.Context) {
	kind := c.Param("kind")
	command, err := systeminfo.Command(kind)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_system_table", err.Error())
		return
	}
	userID := c.GetString("user_id")
	if userID == "" {
		RespondError(c, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return
	}
	serverID := c.Param("serverId")
	connection, err := h.pool.GetOrCreate(userID, serverID)
	if err != nil {
		RespondError(c, http.StatusBadGateway, "ssh_connection_failed", err.Error())
		return
	}
	defer h.pool.Release(userID, serverID)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	result, err := connection.Client.ExecuteCommandDetailedContext(ctx, command)
	if err != nil {
		message := err.Error()
		if result != nil && result.Output != "" {
			message = result.Output
		}
		RespondError(c, http.StatusBadGateway, "system_snapshot_failed", message)
		return
	}
	RespondSuccess(c, systeminfo.Parse(kind, result.Output))
}
