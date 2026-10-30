package rest

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/notificationconfig"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

type notificationConfigStub struct {
	notificationconfig.Service
	input *protocol.NotificationConfigUpdate
	err   error
}

func (s *notificationConfigStub) SaveAllConfig(_ context.Context, input *protocol.NotificationConfigUpdate) error {
	s.input = input
	return s.err
}

func (s *notificationConfigStub) GetAllConfig(context.Context) (*notificationconfig.AllNotificationConfig, error) {
	return &notificationconfig.AllNotificationConfig{
		SMTP:     &notificationconfig.SMTPConfig{Password: "private-password"},
		Webhook:  &notificationconfig.WebhookConfig{URL: "https://example.test/?token=private-token", Secret: "private-secret"},
		DingTalk: &notificationconfig.DingTalkConfig{WebhookURL: "https://example.test/?token=private-token", Secret: "private-secret"},
		WeCom:    &notificationconfig.WeComConfig{WebhookURL: "https://example.test/?token=private-token"},
	}, nil
}

func TestNotificationConfigHTTPUpdate(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		failure    error
		status     int
	}{
		{"partial", `{"enabled":false,"password":""}`, nil, http.StatusOK},
		{"invalid", `{}`, notificationconfig.ErrInvalidConfig, http.StatusBadRequest},
		{"storage", `{}`, errors.New("storage unavailable"), http.StatusInternalServerError},
		{"too large", `{"password":"` + strings.Repeat("x", 1<<20) + `"}`, nil, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stub := &notificationConfigStub{err: tc.failure}
			handler := NewNotificationConfigHandler(stub)
			router := gin.New()
			router.POST("/smtp", handler.SaveSMTPConfig)
			req := httptest.NewRequest(http.MethodPost, "/smtp", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			if response.Code != tc.status {
				t.Fatalf("status %d: %s", response.Code, response.Body.String())
			}
			if tc.name == "partial" {
				if stub.input.SMTP.Enabled == nil || *stub.input.SMTP.Enabled || stub.input.SMTP.Password == nil || *stub.input.SMTP.Password != "" || stub.input.SMTP.Host != nil || stub.input.WeCom != nil {
					t.Fatal("partial update lost input presence")
				}
			}
			if tc.name == "too large" && stub.input != nil {
				t.Fatal("oversized request reached service")
			}
		})
	}
}

func TestNotificationConfigHTTPViewHidesCredentials(t *testing.T) {
	router := gin.New()
	router.GET("/notifications", NewNotificationConfigHandler(&notificationConfigStub{}).GetAllNotificationConfig)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/notifications", nil))
	body := response.Body.String()
	if response.Code != http.StatusOK || strings.Contains(body, "private-") || !strings.Contains(body, `"has_webhook_url":true`) || !strings.Contains(body, `"has_password":true`) {
		t.Fatalf("invalid public response: %s", body)
	}
}
