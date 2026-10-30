package middleware

import (
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/gin-gonic/gin"
	"net/http"
)

// ConnectionContext accepts an ID only after actor authentication. WebSocket
// and download tickets carry the ID themselves; URL parameters cannot replace it.
func ConnectionContext(runtime *access.Runtime, resourceParam string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-EasySSH-Connection")
		if raw, ok := c.Get(ticketContextKey); ok {
			ticket, ok := raw.(*auth.Ticket)
			if !ok || id != "" && id != ticket.ConnectionID {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid_connection"})
				return
			}
			id = ticket.ConnectionID
		}
		connection, err := runtime.Connection(c.Request.Context(), access.Current(c.Request.Context()), id, c.Param(resourceParam))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "connection_unavailable"})
			return
		}
		ctx, done := connection.Bind(c.Request.Context())
		defer done()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
