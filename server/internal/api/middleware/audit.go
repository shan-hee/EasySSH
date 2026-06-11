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

		req := &auditlog.CreateAuditLogRequest{
			UserID:    userID,
			Username:  username,
			Action:    action,
			Resource:  auditResource(c),
			Status:    status,
			IP:        c.ClientIP(),
			UserAgent: c.Request.UserAgent(),
			ErrorMsg:  errorMsg,
			Duration:  time.Since(startTime).Milliseconds(),
		}

		if cfg.EnableDebugLog {
			log.Printf("Audit: action=%s, user=%s, status=%s, ip=%s", action, username, status, c.ClientIP())
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

func determineAction(method, path string) auditlog.ActionType {
	if method == "POST" && (path == "/oauth/authorize" || path == "/api/v1/oauth/authorize") {
		return auditlog.ActionLogin
	}
	if method == "POST" && (path == "/api/v1/oauth/logout" || path == "/api/v1/auth/logout") {
		return auditlog.ActionLogout
	}

	if method == "POST" && path == "/api/v1/servers" {
		return auditlog.ActionServerCreate
	}
	if method == "PUT" && path == "/api/v1/servers/:id" {
		return auditlog.ActionServerUpdate
	}
	if method == "DELETE" && path == "/api/v1/servers/:id" {
		return auditlog.ActionServerDelete
	}
	if method == "POST" && (path == "/api/v1/servers/:id/test" || path == "/api/v1/servers/test") {
		return auditlog.ActionServerTest
	}

	if method == "POST" && path == "/api/v1/users" {
		return auditlog.ActionUserCreate
	}
	if method == "PUT" && path == "/api/v1/users/:id" {
		return auditlog.ActionUserUpdate
	}
	if method == "DELETE" && path == "/api/v1/users/:id" {
		return auditlog.ActionUserDelete
	}
	if method == "POST" && (path == "/api/v1/users/:id/password" ||
		path == "/api/v1/users/:id/lock" ||
		path == "/api/v1/users/:id/unlock") {
		return auditlog.ActionUserUpdate
	}

	return ""
}
