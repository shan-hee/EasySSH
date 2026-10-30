package middleware

import (
	"context"
	"github.com/easyssh/server/internal/testutil"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type configurationAuditAuthority struct {
	testutil.AccessPolicy
}

func (configurationAuditAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}

type configurationAuditLog struct {
	auditlog.Service
	requests []auditlog.CreateAuditLogRequest
}

func (s *configurationAuditLog) Log(_ context.Context, req *auditlog.CreateAuditLogRequest) error {
	s.requests = append(s.requests, *req)
	return nil
}

func TestConfigurationAuditKeepsFailuresWithoutDuplicatingCommittedFacts(t *testing.T) {
	actor := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), configurationAuditAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, path string }{
		{http.MethodPut, "/api/v1/servers/:id"},
		{http.MethodPut, "/api/v1/server-groups/:id"},
		{http.MethodPost, "/api/v1/ssh-keys/generate"},
		{http.MethodPost, "/api/v1/ssh-keys/import"},
		{http.MethodPut, "/api/v1/ssh-keys/:id/passphrase"},
		{http.MethodDelete, "/api/v1/ssh-keys/:id"},
		{http.MethodPost, "/api/v1/scripts"},
		{http.MethodPut, "/api/v1/scripts/:id"},
		{http.MethodDelete, "/api/v1/scripts/:id"},
		{http.MethodPost, "/api/v1/scheduled-tasks"},
		{http.MethodPut, "/api/v1/scheduled-tasks/:id"},
		{http.MethodDelete, "/api/v1/scheduled-tasks/:id"},
		{http.MethodPost, "/api/v1/scheduled-tasks/:id/toggle"},
		{http.MethodPut, "/api/v1/owner/ai-config"},
		{http.MethodDelete, "/api/v1/owner/ai-config"},
		{http.MethodPost, "/api/v1/grants"},
		{http.MethodPut, "/api/v1/grants/:id"},
		{http.MethodDelete, "/api/v1/grants/:id"},
		{http.MethodPost, "/api/v1/grants/:id/rotate-secret"},
		{http.MethodPost, "/api/v1/grants/:id/resources/:server_id/confirm"},
		{http.MethodDelete, "/api/v1/grants/sessions/:id"},
		{http.MethodPatch, "/api/v1/settings/system/basic"},
		{http.MethodPatch, "/api/v1/settings/system/file-transfer"},
		{http.MethodPatch, "/api/v1/settings/system/scheduled-tasks"},
		{http.MethodPost, "/api/v1/settings/workspace"},
		{http.MethodPost, "/api/v1/settings/login-session"},
		{http.MethodPost, "/api/v1/settings/login-security"},
		{http.MethodPost, "/api/v1/settings/web-security"},
		{http.MethodPost, "/api/v1/settings/cors"},
		{http.MethodPost, "/api/v1/settings/access-control"},
		{http.MethodPost, "/api/v1/settings/notifications"},
		{http.MethodPost, "/api/v1/settings/smtp"},
		{http.MethodPost, "/api/v1/settings/webhook"},
		{http.MethodPost, "/api/v1/settings/dingtalk"},
		{http.MethodPost, "/api/v1/settings/wecom"},
		{http.MethodPut, "/api/v1/owner/profile"},
		{http.MethodPut, "/api/v1/owner/password"},
		{http.MethodPost, "/api/v1/owner/2fa/enable"},
		{http.MethodPost, "/api/v1/owner/2fa/disable"},
		{http.MethodDelete, "/api/v1/owner/sessions/:session_id"},
		{http.MethodPost, "/api/v1/owner/sessions/revoke-others"},
		{http.MethodPut, "/api/v1/owner/notifications"},
		{http.MethodPut, "/api/v1/owner/monitor-datasource"},
	} {
		for _, status := range []int{http.StatusOK, http.StatusBadRequest} {
			service := &configurationAuditLog{}
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Request = c.Request.WithContext(access.WithScope(c.Request.Context(), scope))
				c.Next()
			})
			router.Use(AuditLogMiddleware(service, nil))
			router.Handle(route.method, route.path, func(c *gin.Context) { c.Status(status) })
			id := uuid.NewString()
			path := strings.ReplaceAll(route.path, ":id", id)
			path = strings.ReplaceAll(path, ":server_id", id)
			path = strings.ReplaceAll(path, ":session_id", id)
			resource := path
			if path != route.path && !strings.Contains(route.path, ":session_id") {
				resource = id
			}
			router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(route.method, path, nil))
			if status == http.StatusOK {
				if len(service.requests) != 0 {
					t.Fatalf("%s: committed fact counted again by HTTP audit", route.path)
				}
			} else if len(service.requests) != 1 || service.requests[0].Actor != actor || service.requests[0].Status != auditlog.StatusFailure || service.requests[0].Resource != resource {
				t.Fatalf("%s: failed attempt omitted or misattributed: %+v", route.path, service.requests)
			}
		}
	}
}

func TestDetermineActionCoversGovernanceMutations(t *testing.T) {
	tests := []struct {
		method string
		path   string
		want   auditlog.ActionType
	}{
		{"PUT", "/api/v1/owner/password", auditlog.ActionSecurityUpdate},
		{"PUT", "/api/v1/owner/profile", auditlog.ActionProfileUpdate},
		{"POST", "/api/v1/scripts/:id/execute", auditlog.ActionScriptExecute},
		{"PATCH", "/api/v1/settings/system/scheduled-tasks", auditlog.ActionSystemSettingsUpdate},
		{"POST", "/api/v1/settings/notifications", auditlog.ActionNotificationSettingsUpdate},
		{"PUT", "/api/v1/owner/ai-config", auditlog.ActionAIConfigUpdate},
		{"DELETE", "/api/v1/owner/ai-config", auditlog.ActionAIConfigUpdate},
		{"POST", "/api/v1/server-groups", auditlog.ActionServerGroupCreate},
		{"PUT", "/api/v1/server-groups/:id", auditlog.ActionServerGroupUpdate},
		{"DELETE", "/api/v1/server-groups/:id", auditlog.ActionServerGroupDelete},
		{"POST", "/api/v1/ssh-keys/generate", auditlog.ActionSSHKeyGenerate},
		{"POST", "/api/v1/ssh-keys/import", auditlog.ActionSSHKeyImport},
		{"PUT", "/api/v1/ssh-keys/:id/passphrase", auditlog.ActionSSHKeyPassphraseUpdate},
		{"DELETE", "/api/v1/ssh-keys/:id", auditlog.ActionSSHKeyDelete},
		{"POST", "/api/v1/grants", auditlog.ActionGrantCreate},
		{"PUT", "/api/v1/grants/:id", auditlog.ActionGrantUpdate},
		{"DELETE", "/api/v1/grants/:id", auditlog.ActionGrantRevoke},
		{"POST", "/api/v1/grants/:id/rotate-secret", auditlog.ActionGrantRotateSecret},
		{"POST", "/api/v1/grants/:id/resources/:server_id/confirm", auditlog.ActionGrantConfirmResource},
		{"DELETE", "/api/v1/grants/sessions/:id", auditlog.ActionGrantEndSession},
		{"GET", "/api/v1/ssh-keys", ""},
		{"GET", "/api/v1/grants/:id", ""},
		{"POST", "/api/v1/owner/ai-config/models", ""},
		{"DELETE", "/api/v1/logs/cleanup", auditlog.ActionAuditLogsCleanup},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			if got := determineAction(test.method, test.path); got != test.want {
				t.Fatalf("determineAction() = %q, want %q", got, test.want)
			}
		})
	}
}
