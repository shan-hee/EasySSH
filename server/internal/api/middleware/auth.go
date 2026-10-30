package middleware

import (
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"math"
	"net/http"
	"time"
)

const OwnerCookieName = "easyssh_owner"
const ticketContextKey = "auth_ticket"

func ticketExpectationForRequest(c *gin.Context) (auth.TicketExpectation, bool) {
	switch c.FullPath() {
	case "/api/v1/transfer-jobs/:id/artifact":
		return auth.TicketExpectation{Type: auth.TicketTypeTransferArtifact, Ref: c.Param("id")}, true
	case "/api/v1/backup/instances/:id/download":
		return auth.TicketExpectation{Type: auth.TicketTypeInstanceBackupDownload, Ref: c.Param("id")}, true
	case "/api/v1/ssh/terminal/:server_id":
		return auth.TicketExpectation{Type: auth.TicketTypeWSTerminal, Ref: c.Param("server_id")}, true
	case "/api/v1/monitor/server/:server_id":
		return auth.TicketExpectation{Type: auth.TicketTypeWSMonitor, Ref: c.Param("server_id")}, true
	case "/api/v1/sftp/:server_id/auth/ws":
		return auth.TicketExpectation{Type: auth.TicketTypeWSSFTPAuth, Ref: c.Param("server_id")}, true
	default:
		return auth.TicketExpectation{}, false
	}
}

// Owner authentication never falls back from visitor credentials to a cookie.
func AuthMiddleware(owner *auth.Service, tickets auth.TicketService, securityService security.Service) gin.HandlerFunc {
	return authenticateContext(owner, tickets, securityService, nil)
}

// ExecutionAuth selects explicit visitor credentials without falling back to
// owner cookies. Owner-only groups continue to use AuthMiddleware.
func ExecutionAuth(owner *auth.Service, tickets auth.TicketService, securityService security.Service, visitor gin.HandlerFunc) gin.HandlerFunc {
	return authenticateContext(owner, tickets, securityService, visitor)
}
func authenticateContext(owner *auth.Service, tickets auth.TicketService, securityService security.Service, visitor gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, release := owner.RequestContext(c.Request.Context())
		defer release()
		c.Request = c.Request.WithContext(ctx)
		if _, requiresTicket := ticketExpectationForRequest(c); requiresTicket && c.Request.Method == http.MethodGet && c.Query("ticket") == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "ticket_required"})
			return
		}
		if visitor != nil && c.Query("ticket") == "" && (c.GetHeader("Authorization") != "" || c.GetHeader("X-EasySSH-Access-Session") != "") {
			visitor(c)
			return
		}
		var scope access.Scope
		var session *auth.Session
		var token string
		var err error
		if raw := c.Query("ticket"); raw != "" {
			expect, ok := ticketExpectationForRequest(c)
			if !ok {
				c.AbortWithStatusJSON(401, gin.H{"error": "invalid_ticket"})
				return
			}
			ticket, ticketErr := tickets.Consume(c.Request.Context(), raw, expect)
			if ticketErr != nil {
				c.AbortWithStatusJSON(401, gin.H{"error": "invalid_ticket"})
				return
			}
			scope = ticket.Scope
			c.Set(ticketContextKey, ticket)
		} else {
			if c.GetHeader("Authorization") != "" || c.GetHeader("X-EasySSH-Access-Session") != "" {
				c.AbortWithStatusJSON(401, gin.H{"error": "wrong_access_context"})
				return
			}
			token, _ = c.Cookie(OwnerCookieName)
			mutation := c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead && c.Request.Method != http.MethodOptions
			scope, session, err = owner.Authenticate(c.Request.Context(), token, c.GetHeader(CSRFTokenHeader), mutation)
		}
		if err != nil || !scope.IsOwner() && (visitor == nil || scope.Actor().Kind != protocol.Visitor) {
			c.AbortWithStatusJSON(401, gin.H{"error": "owner_authentication_required"})
			return
		}
		if scope.IsOwner() && !checkOwnerAddress(c, securityService) {
			return
		}
		if session != nil {
			SetOwnerSessionCookie(c, token, session, securityService)
		}
		c.Request = c.Request.WithContext(access.WithScope(c.Request.Context(), scope))
		c.Next()
	}
}

// OwnerIdentity is used by owner-only operations. It is derived exclusively from
// the authenticated scope and is never populated by request body or string keys.
func OwnerIdentity(c *gin.Context) (any, bool) {
	scope, err := access.FromContext(c.Request.Context())
	if err != nil || !scope.IsOwner() {
		return nil, false
	}
	if err := scope.RequireOwner(c.Request.Context(), protocol.OwnerManage); err != nil {
		return nil, false
	}
	return scope.Actor().ID, true
}
func OwnerID(c *gin.Context) string {
	value, ok := OwnerIdentity(c)
	if !ok {
		return ""
	}
	return value.(string)
}

// SetOwnerSessionCookie keeps browser persistence aligned with the renewed
// server deadline. A session cookie has no Max-Age or Expires attributes.
func SetOwnerSessionCookie(c *gin.Context, token string, session *auth.Session, securityService security.Service) {
	cookie := &http.Cookie{Name: OwnerCookieName, Value: token, Path: "/", HttpOnly: true, Secure: RequestUsesHTTPS(c, securityService), SameSite: http.SameSiteStrictMode}
	if session.RememberLogin {
		cookie.Expires = session.ExpiresAt
		cookie.MaxAge = max(1, int(math.Ceil(time.Until(session.ExpiresAt).Seconds())))
	}
	http.SetCookie(c.Writer, cookie)
	c.Header("Cache-Control", "no-store")
}
