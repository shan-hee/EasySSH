package rest

import (
	"encoding/hex"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/domain/auth"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type TicketHandler struct {
	ticketService auth.TicketService
}

func NewTicketHandler(ticketService auth.TicketService) *TicketHandler {
	return &TicketHandler{ticketService: ticketService}
}

// CreateTicket 创建一次性 Ticket（用于 WebSocket 握手 / 原生下载等无法附带 Authorization Header 的场景）
// POST /api/v1/access/tickets
func (h *TicketHandler) CreateTicket(c *gin.Context) {
	if h.ticketService == nil {
		RespondError(c, http.StatusServiceUnavailable, "ticket_not_available", "Ticket service not available")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
	var req protocol.AccessTicketInput
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	tt := auth.TicketType(strings.TrimSpace(req.Type))
	if !tt.IsValid() {
		RespondError(c, http.StatusBadRequest, "invalid_ticket_type", "Invalid ticket type")
		return
	}

	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	createReq := auth.CreateTicketRequest{Type: tt, Scope: scope, ConnectionID: req.ConnectionID}

	switch tt {
	case auth.TicketTypeInstanceBackupDownload:
		id := strings.TrimSpace(req.BackupID)
		_, err := hex.DecodeString(id)
		if len(id) != 32 || err != nil || id != strings.ToLower(id) {
			RespondError(c, http.StatusBadRequest, "invalid_backup_id", "Invalid backup_id")
			return
		}
		createReq.Ref = id

	case auth.TicketTypeWSRDP, auth.TicketTypeWSVNC, auth.TicketTypeWSTerminal, auth.TicketTypeWSMonitor, auth.TicketTypeWSSFTPAuth:
		serverID := strings.TrimSpace(req.ServerID)
		if serverID == "" {
			RespondError(c, http.StatusBadRequest, "missing_server_id", "server_id is required")
			return
		}
		if _, err := uuid.Parse(serverID); err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server_id")
			return
		}
		createReq.Ref = serverID

	case auth.TicketTypeTransferArtifact:
		taskID := strings.TrimSpace(req.TaskID)
		if taskID == "" {
			RespondError(c, http.StatusBadRequest, "missing_task_id", "task_id is required")
			return
		}
		if len(taskID) > 256 {
			RespondError(c, http.StatusBadRequest, "invalid_task_id", "task_id too long")
			return
		}
		createReq.Ref = taskID

	}

	ticket, expiresIn, err := h.ticketService.Create(c.Request.Context(), createReq)
	if err != nil {
		accessError(c, err)
		return
	}

	RespondSuccess(c, protocol.AccessTicket{
		Ticket:    ticket,
		ExpiresIn: expiresIn,
	})
}
