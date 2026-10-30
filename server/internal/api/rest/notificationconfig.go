package rest

import (
	"errors"
	"net/http"

	"github.com/easyssh/server/internal/domain/notificationconfig"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

type NotificationConfigHandler struct{ service notificationconfig.Service }

func NewNotificationConfigHandler(service notificationconfig.Service) *NotificationConfigHandler {
	return &NotificationConfigHandler{service: service}
}

func notificationConfigError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, notificationconfig.ErrInvalidConfig) || errors.Is(err, notificationconfig.ErrConnectionTest) {
		status = http.StatusBadRequest
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

func (h *NotificationConfigHandler) GetSMTPConfig(c *gin.Context) {
	config, err := h.service.GetSMTPConfig(c.Request.Context())
	if err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.SMTPConfigResponse{Config: config.Public()})
}

func (h *NotificationConfigHandler) SaveSMTPConfig(c *gin.Context) {
	var input protocol.SMTPConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.SaveAllConfig(c.Request.Context(), &protocol.NotificationConfigUpdate{SMTP: &input}); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "SMTP configuration saved successfully"})
}

func (h *NotificationConfigHandler) TestSMTPConnection(c *gin.Context) {
	var input protocol.SMTPConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.TestSMTPConnection(c.Request.Context(), &input); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "SMTP connection test successful"})
}

func (h *NotificationConfigHandler) GetWebhookConfig(c *gin.Context) {
	config, err := h.service.GetWebhookConfig(c.Request.Context())
	if err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.WebhookConfigResponse{Config: config.Public()})
}

func (h *NotificationConfigHandler) SaveWebhookConfig(c *gin.Context) {
	var input protocol.WebhookConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.SaveAllConfig(c.Request.Context(), &protocol.NotificationConfigUpdate{Webhook: &input}); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "Webhook configuration saved successfully"})
}

func (h *NotificationConfigHandler) TestWebhookConnection(c *gin.Context) {
	var input protocol.WebhookConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.TestWebhookConnection(c.Request.Context(), &input); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "Webhook connection test successful"})
}

func (h *NotificationConfigHandler) GetDingTalkConfig(c *gin.Context) {
	config, err := h.service.GetDingTalkConfig(c.Request.Context())
	if err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.DingTalkConfigResponse{Config: config.Public()})
}

func (h *NotificationConfigHandler) SaveDingTalkConfig(c *gin.Context) {
	var input protocol.DingTalkConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.SaveAllConfig(c.Request.Context(), &protocol.NotificationConfigUpdate{DingTalk: &input}); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "DingTalk configuration saved successfully"})
}

func (h *NotificationConfigHandler) TestDingTalkConnection(c *gin.Context) {
	var input protocol.DingTalkConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.TestDingTalkConnection(c.Request.Context(), &input); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "DingTalk connection test successful"})
}

func (h *NotificationConfigHandler) GetWeComConfig(c *gin.Context) {
	config, err := h.service.GetWeComConfig(c.Request.Context())
	if err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.WeComConfigResponse{Config: config.Public()})
}

func (h *NotificationConfigHandler) SaveWeComConfig(c *gin.Context) {
	var input protocol.WeComConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.SaveAllConfig(c.Request.Context(), &protocol.NotificationConfigUpdate{WeCom: &input}); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "WeCom configuration saved successfully"})
}

func (h *NotificationConfigHandler) TestWeComConnection(c *gin.Context) {
	var input protocol.WeComConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.TestWeComConnection(c.Request.Context(), &input); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "WeCom connection test successful"})
}

func (h *NotificationConfigHandler) GetAllNotificationConfig(c *gin.Context) {
	config, err := h.service.GetAllConfig(c.Request.Context())
	if err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.NotificationConfigResponse{Config: config.Public()})
}

func (h *NotificationConfigHandler) SaveAllNotificationConfig(c *gin.Context) {
	var input protocol.NotificationConfigUpdate
	if !bindJSON(c, &input) {
		return
	}
	if err := h.service.SaveAllConfig(c.Request.Context(), &input); err != nil {
		notificationConfigError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "Notification configuration saved successfully"})
}
