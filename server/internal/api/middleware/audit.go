package middleware

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
		startTime := time.Now()
		c.Next()

		action := determineAction(c.Request.Method, c.FullPath())
		if action == "" {
			return
		}

		userID, username, ok := auditUser(c)
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
		clientIP := LogClientIP(c)

		req := &auditlog.CreateAuditLogRequest{
			UserID:    userID,
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

		ctx, cancel := context.WithTimeout(context.Background(), cfg.AsyncTimeout)
		go func() {
			defer cancel()
			if err := auditService.Log(ctx, req); err != nil {
				log.Printf("Failed to log audit: %v (action=%s, user=%s)", err, req.Action, req.Username)
			}
		}()
	}
}

func auditUser(c *gin.Context) (uuid.UUID, string, bool) {
	userID := uuid.Nil
	username := ""

	if value, exists := c.Get("user_id"); exists {
		userIDString, ok := value.(string)
		if !ok {
			return uuid.Nil, "", false
		}
		parsed, err := uuid.Parse(userIDString)
		if err != nil {
			return uuid.Nil, "", false
		}
		userID = parsed
	}

	if value, exists := c.Get("username"); exists {
		if parsed, ok := value.(string); ok {
			username = parsed
		}
	}

	return userID, username, userID != uuid.Nil || username != ""
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
	{"POST", "/oauth/authorize"}:        auditlog.ActionLogin,
	{"POST", "/api/v1/oauth/authorize"}: auditlog.ActionLogin,
	{"POST", "/api/v1/oauth/logout"}:    auditlog.ActionLogout,
	{"POST", "/api/v1/auth/logout"}:     auditlog.ActionLogout,

	{"POST", "/api/v1/servers"}:          auditlog.ActionServerCreate,
	{"PUT", "/api/v1/servers/:id"}:       auditlog.ActionServerUpdate,
	{"DELETE", "/api/v1/servers/:id"}:    auditlog.ActionServerDelete,
	{"POST", "/api/v1/servers/:id/test"}: auditlog.ActionServerTest,
	{"POST", "/api/v1/servers/test"}:     auditlog.ActionServerTest,

	{"POST", "/api/v1/users"}:              auditlog.ActionUserCreate,
	{"PUT", "/api/v1/users/:id"}:           auditlog.ActionUserUpdate,
	{"DELETE", "/api/v1/users/:id"}:        auditlog.ActionUserDelete,
	{"POST", "/api/v1/users/:id/password"}: auditlog.ActionUserUpdate,
	{"POST", "/api/v1/users/:id/lock"}:     auditlog.ActionUserUpdate,
	{"POST", "/api/v1/users/:id/unlock"}:   auditlog.ActionUserUpdate,

	{"POST", "/api/v1/scheduled-tasks"}:             auditlog.ActionScheduledTaskCreate,
	{"PUT", "/api/v1/scheduled-tasks/:id"}:          auditlog.ActionScheduledTaskUpdate,
	{"DELETE", "/api/v1/scheduled-tasks/:id"}:       auditlog.ActionScheduledTaskDelete,
	{"POST", "/api/v1/scheduled-tasks/:id/toggle"}:  auditlog.ActionScheduledTaskToggle,
	{"POST", "/api/v1/scheduled-tasks/:id/trigger"}: auditlog.ActionScheduledTaskTrigger,
}

func determineAction(method, path string) auditlog.ActionType {
	return auditActionByRoute[auditRouteKey{method: method, path: path}]
}
