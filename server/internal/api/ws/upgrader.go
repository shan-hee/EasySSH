package ws

import (
	"net/http"

	"github.com/easyssh/server/internal/api/middleware"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// Every caller is behind ExecutionAuth and ConnectionContext. The consumed,
// short-lived ticket is bound to the endpoint, resource, and authenticated actor;
// an automatically attached browser cookie alone cannot authorize an upgrade.
func ticketUpgrader(c *gin.Context, protocols ...string) websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		Subprotocols:    protocols,
		CheckOrigin: func(*http.Request) bool {
			return middleware.HasAuthenticatedTicket(c)
		},
	}
}
