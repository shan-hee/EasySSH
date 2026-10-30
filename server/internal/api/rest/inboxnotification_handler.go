package rest

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/easyssh/server/internal/domain/inboxnotification"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type InboxNotificationHandler struct{ service inboxnotification.Service }

func NewInboxNotificationHandler(service inboxnotification.Service) *InboxNotificationHandler {
	return &InboxNotificationHandler{service: service}
}

func (h *InboxNotificationHandler) List(c *gin.Context) {
	ownerID, ok := requireCurrentOwnerID(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	var unread *bool
	if value := strings.TrimSpace(c.Query("unread")); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_unread_filter", "Invalid unread filter")
			return
		}
		unread = &parsed
	}
	result, err := h.service.List(c.Request.Context(), &inboxnotification.ListRequest{OwnerID: ownerID, Unread: unread, Severity: c.Query("severity"), Page: page, PageSize: pageSize})
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "list_notifications_failed", err.Error())
		return
	}
	RespondSuccess(c, result)
}

func (h *InboxNotificationHandler) MarkRead(c *gin.Context) {
	ownerID, id, ok := inboxUserAndID(c)
	if !ok {
		return
	}
	if err := h.service.MarkRead(c.Request.Context(), ownerID, id); err != nil {
		RespondError(c, http.StatusInternalServerError, "mark_notification_read_failed", err.Error())
		return
	}
	RespondSuccess(c, gin.H{"id": id, "read": true})
}

func (h *InboxNotificationHandler) MarkAllRead(c *gin.Context) {
	ownerID, ok := requireCurrentOwnerID(c)
	if !ok {
		return
	}
	if err := h.service.MarkAllRead(c.Request.Context(), ownerID); err != nil {
		RespondError(c, http.StatusInternalServerError, "mark_all_notifications_read_failed", err.Error())
		return
	}
	RespondSuccess(c, gin.H{"read": true})
}

func (h *InboxNotificationHandler) Delete(c *gin.Context) {
	ownerID, id, ok := inboxUserAndID(c)
	if !ok {
		return
	}
	if err := h.service.Delete(c.Request.Context(), ownerID, id); err != nil {
		RespondError(c, http.StatusInternalServerError, "delete_notification_failed", err.Error())
		return
	}
	RespondSuccess(c, gin.H{"id": id})
}

func (h *InboxNotificationHandler) ClearRead(c *gin.Context) {
	ownerID, ok := requireCurrentOwnerID(c)
	if !ok {
		return
	}
	if err := h.service.ClearRead(c.Request.Context(), ownerID); err != nil {
		RespondError(c, http.StatusInternalServerError, "clear_notifications_failed", err.Error())
		return
	}
	RespondSuccess(c, gin.H{"cleared": true})
}

func inboxUserAndID(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
	ownerID, ok := requireCurrentOwnerID(c)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_notification_id", "Invalid notification ID")
		return uuid.Nil, uuid.Nil, false
	}
	return ownerID, id, true
}
