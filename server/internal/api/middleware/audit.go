package middleware

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/gin-gonic/gin"
)

type AuditConfig struct {
	EnableDebugLog bool
	AsyncTimeout   time.Duration
}

func DefaultAuditConfig() *AuditConfig {
	env := os.Getenv("ENV")
	return &AuditConfig{
		EnableDebugLog: env == "development" || env == "dev",
		AsyncTimeout:   3 * time.Second,
	}
}

func AuditLogMiddleware(auditService auditlog.Service, cfg *AuditConfig) gin.HandlerFunc {
	if cfg == nil {
		cfg = DefaultAuditConfig()
	}

	return func(c *gin.Context) {
		action := determineAction(c.Request.Method, c.FullPath())
		if action == "" {
			c.Next()
			return
		}
		c.Request = c.Request.WithContext(operationrecord.WithRequestMetadata(c.Request.Context(), operationrecord.RequestMetadata{
			Username: c.GetString("username"), IP: LogClientIP(c), UserAgent: c.Request.UserAgent(),
		}))
		startTime := time.Now()
		c.Next()

		actor := access.Current(c.Request.Context()).Actor()
		username := c.GetString("username")
		ok := actor.Valid()
		if !ok && action != auditlog.ActionLogin && action != auditlog.ActionLogout {
			return
		}

		status := auditlog.StatusSuccess
		errorMsg := ""
		if c.Writer.Status() >= 400 {
			status = auditlog.StatusFailure
			if len(c.Errors) > 0 {
				errorMsg = c.Errors.String()
			}
		}
		// Successful configuration mutations commit their own activity in the source
		// transaction. Keep failed HTTP attempts, but never count success twice.
		if status == auditlog.StatusSuccess {
			switch action {
			case auditlog.ActionServerCreate, auditlog.ActionServerUpdate, auditlog.ActionServerDelete, auditlog.ActionServerReorder,
				auditlog.ActionServerGroupCreate, auditlog.ActionServerGroupUpdate, auditlog.ActionServerGroupDelete,
				auditlog.ActionSSHKeyGenerate, auditlog.ActionSSHKeyImport, auditlog.ActionSSHKeyDelete, auditlog.ActionSSHKeyPassphraseUpdate,
				auditlog.ActionScriptCreate, auditlog.ActionScriptUpdate, auditlog.ActionScriptDelete,
				auditlog.ActionScheduledTaskCreate, auditlog.ActionScheduledTaskUpdate, auditlog.ActionScheduledTaskDelete, auditlog.ActionScheduledTaskToggle,
				auditlog.ActionAIConfigUpdate,
				auditlog.ActionGrantCreate, auditlog.ActionGrantUpdate, auditlog.ActionGrantRevoke,
				auditlog.ActionGrantRotateSecret, auditlog.ActionGrantConfirmResource, auditlog.ActionGrantEndSession,
				auditlog.ActionSystemSettingsUpdate, auditlog.ActionSecuritySettingsUpdate, auditlog.ActionNotificationSettingsUpdate,
				auditlog.ActionProfileUpdate, auditlog.ActionSecurityUpdate:
				return
			}
		}
		clientIP := LogClientIP(c)

		req := &auditlog.CreateAuditLogRequest{
			Actor:     actor,
			Username:  username,
			Action:    action,
			Resource:  auditResource(c),
			Status:    status,
			IP:        clientIP,
			UserAgent: c.Request.UserAgent(),
			ErrorMsg:  errorMsg,
			Duration:  time.Since(startTime).Milliseconds(),
		}

		if cfg.EnableDebugLog {
			log.Printf("Audit: action=%s, user=%s, status=%s, ip=%s", action, username, status, clientIP)
		}

		ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), cfg.AsyncTimeout)
		defer cancel()
		if err := auditService.Log(ctx, req); err != nil {
			log.Printf("Failed to log audit: %v (action=%s, user=%s)", err, req.Action, req.Username)
		}
	}
}

func auditResource(c *gin.Context) string {
	if resource := c.Param("server_id"); resource != "" {
		return resource
	}
	if resource := c.Param("serverId"); resource != "" {
		return resource
	}
	if resource := c.Param("id"); resource != "" {
		return resource
	}
	return c.Request.URL.Path
}

type auditRouteKey struct {
	method string
	path   string
}

var auditActionByRoute = map[auditRouteKey]auditlog.ActionType{
	{"POST", "/api/v1/owner/login"}:  auditlog.ActionLogin,
	{"POST", "/api/v1/owner/logout"}: auditlog.ActionLogout,

	{"POST", "/api/v1/servers"}:          auditlog.ActionServerCreate,
	{"PUT", "/api/v1/servers/:id"}:       auditlog.ActionServerUpdate,
	{"DELETE", "/api/v1/servers/:id"}:    auditlog.ActionServerDelete,
	{"POST", "/api/v1/servers/:id/test"}: auditlog.ActionServerTest,
	{"POST", "/api/v1/servers/test"}:     auditlog.ActionServerTest,
	{"PATCH", "/api/v1/servers/reorder"}: auditlog.ActionServerReorder,

	{"POST", "/api/v1/server-groups"}:       auditlog.ActionServerGroupCreate,
	{"PUT", "/api/v1/server-groups/:id"}:    auditlog.ActionServerGroupUpdate,
	{"DELETE", "/api/v1/server-groups/:id"}: auditlog.ActionServerGroupDelete,

	{"POST", "/api/v1/ssh-keys/generate"}:      auditlog.ActionSSHKeyGenerate,
	{"POST", "/api/v1/ssh-keys/import"}:        auditlog.ActionSSHKeyImport,
	{"DELETE", "/api/v1/ssh-keys/:id"}:         auditlog.ActionSSHKeyDelete,
	{"PUT", "/api/v1/ssh-keys/:id/passphrase"}: auditlog.ActionSSHKeyPassphraseUpdate,

	{"POST", "/api/v1/grants"}:                                  auditlog.ActionGrantCreate,
	{"PUT", "/api/v1/grants/:id"}:                               auditlog.ActionGrantUpdate,
	{"DELETE", "/api/v1/grants/:id"}:                            auditlog.ActionGrantRevoke,
	{"POST", "/api/v1/grants/:id/rotate-secret"}:                auditlog.ActionGrantRotateSecret,
	{"POST", "/api/v1/grants/:id/resources/:server_id/confirm"}: auditlog.ActionGrantConfirmResource,
	{"DELETE", "/api/v1/grants/sessions/:id"}:                   auditlog.ActionGrantEndSession,

	{"POST", "/api/v1/scheduled-tasks"}:             auditlog.ActionScheduledTaskCreate,
	{"PUT", "/api/v1/scheduled-tasks/:id"}:          auditlog.ActionScheduledTaskUpdate,
	{"DELETE", "/api/v1/scheduled-tasks/:id"}:       auditlog.ActionScheduledTaskDelete,
	{"POST", "/api/v1/scheduled-tasks/:id/toggle"}:  auditlog.ActionScheduledTaskToggle,
	{"POST", "/api/v1/scheduled-tasks/:id/trigger"}: auditlog.ActionScheduledTaskTrigger,

	{"PUT", "/api/v1/owner/profile"}:                 auditlog.ActionProfileUpdate,
	{"PUT", "/api/v1/owner/password"}:                auditlog.ActionSecurityUpdate,
	{"POST", "/api/v1/owner/2fa/enable"}:             auditlog.ActionSecurityUpdate,
	{"POST", "/api/v1/owner/2fa/disable"}:            auditlog.ActionSecurityUpdate,
	{"DELETE", "/api/v1/owner/sessions/:session_id"}: auditlog.ActionSecurityUpdate,
	{"POST", "/api/v1/owner/sessions/revoke-others"}: auditlog.ActionSecurityUpdate,
	{"PUT", "/api/v1/owner/notifications"}:           auditlog.ActionProfileUpdate,
	{"PUT", "/api/v1/owner/monitor-datasource"}:      auditlog.ActionProfileUpdate,
	{"PUT", "/api/v1/owner/ai-config"}:               auditlog.ActionAIConfigUpdate,
	{"DELETE", "/api/v1/owner/ai-config"}:            auditlog.ActionAIConfigUpdate,

	{"POST", "/api/v1/scripts"}:             auditlog.ActionScriptCreate,
	{"PUT", "/api/v1/scripts/:id"}:          auditlog.ActionScriptUpdate,
	{"DELETE", "/api/v1/scripts/:id"}:       auditlog.ActionScriptDelete,
	{"POST", "/api/v1/scripts/:id/execute"}: auditlog.ActionScriptExecute,

	{"PATCH", "/api/v1/settings/system/basic"}:           auditlog.ActionSystemSettingsUpdate,
	{"PATCH", "/api/v1/settings/system/file-transfer"}:   auditlog.ActionSystemSettingsUpdate,
	{"PATCH", "/api/v1/settings/system/scheduled-tasks"}: auditlog.ActionSystemSettingsUpdate,
	{"POST", "/api/v1/settings/workspace"}:               auditlog.ActionSecuritySettingsUpdate,
	{"POST", "/api/v1/settings/login-session"}:           auditlog.ActionSecuritySettingsUpdate,
	{"POST", "/api/v1/settings/login-security"}:          auditlog.ActionSecuritySettingsUpdate,
	{"POST", "/api/v1/settings/web-security"}:            auditlog.ActionSecuritySettingsUpdate,
	{"POST", "/api/v1/settings/cors"}:                    auditlog.ActionSecuritySettingsUpdate,
	{"POST", "/api/v1/settings/access-control"}:          auditlog.ActionSecuritySettingsUpdate,
	{"POST", "/api/v1/settings/notifications"}:           auditlog.ActionNotificationSettingsUpdate,
	{"POST", "/api/v1/settings/smtp"}:                    auditlog.ActionNotificationSettingsUpdate,
	{"POST", "/api/v1/settings/webhook"}:                 auditlog.ActionNotificationSettingsUpdate,
	{"POST", "/api/v1/settings/dingtalk"}:                auditlog.ActionNotificationSettingsUpdate,
	{"POST", "/api/v1/settings/wecom"}:                   auditlog.ActionNotificationSettingsUpdate,
	{"DELETE", "/api/v1/logs/cleanup"}:                   auditlog.ActionAuditLogsCleanup,
}

func determineAction(method, path string) auditlog.ActionType {
	return auditActionByRoute[auditRouteKey{method: method, path: path}]
}
