package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type upgradePolicy struct{ testutil.AccessPolicy }

func (upgradePolicy) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}

type upgradeTickets struct {
	auth.TicketService
	ticket auth.Ticket
	used   atomic.Bool
}

func (s *upgradeTickets) Consume(_ context.Context, value string, expect auth.TicketExpectation) (*auth.Ticket, error) {
	if value != "valid-ticket" || expect.Type != s.ticket.Type || expect.Ref != s.ticket.Ref || !s.used.CompareAndSwap(false, true) {
		return nil, auth.ErrInvalidTicket
	}
	now := time.Now()
	s.ticket.UsedAt = &now
	return &s.ticket, nil
}

func TestTicketWebSocketsBehindHTTPSProxy(t *testing.T) {
	for _, endpoint := range []struct {
		path string
		kind auth.TicketType
	}{
		{"/api/v1/ssh/terminal/:server_id", auth.TicketTypeWSTerminal},
		{"/api/v1/monitor/server/:server_id", auth.TicketTypeWSMonitor},
		{"/api/v1/sftp/:server_id/auth/ws", auth.TicketTypeWSSFTPAuth},
		{"/api/v1/vnc/:server_id/ws", auth.TicketTypeWSVNC},
		{"/api/v1/rdp/:server_id/ws", auth.TicketTypeWSRDP},
	} {
		t.Run(string(endpoint.kind), func(t *testing.T) {
			actor := protocol.Actor{Kind: protocol.Visitor, ID: "visitor-session", SessionID: "visitor-session", GrantID: "grant"}
			scope, err := access.NewScope(actor, time.Now().Add(time.Minute), upgradePolicy{})
			if err != nil {
				t.Fatal(err)
			}
			tickets := &upgradeTickets{ticket: auth.Ticket{Type: endpoint.kind, Ref: "server-1", Scope: scope}}
			router := gin.New()
			// Ticket routes must never fall back to a cookie or visitor headers.
			router.GET(endpoint.path, middleware.ExecutionAuth(&auth.Service{}, tickets, nil, func(c *gin.Context) {
				c.AbortWithStatus(http.StatusInternalServerError)
			}), func(c *gin.Context) {
				upgrader := ticketUpgrader(c)
				connection, err := upgrader.Upgrade(c.Writer, c.Request, nil)
				if err == nil {
					_ = connection.Close()
				}
			})
			server := httptest.NewServer(router)
			defer server.Close()
			base := "ws" + strings.TrimPrefix(server.URL, "http") + strings.ReplaceAll(endpoint.path, ":server_id", "server-1")
			headers := http.Header{
				"Origin": {"https://" + strings.TrimPrefix(server.URL, "http://")},
				"Cookie": {"easyssh_owner=automatically-attached-cookie"},
			}
			for _, query := range []string{"", "?ticket=invalid", "?ticket=valid-ticket", "?ticket=valid-ticket"} {
				alreadyUsed := tickets.used.Load()
				connection, response, err := websocket.DefaultDialer.Dial(base+query, headers)
				if connection != nil {
					_ = connection.Close()
				}
				if response != nil && response.Body != nil {
					_ = response.Body.Close()
				}
				if query == "?ticket=valid-ticket" && !alreadyUsed {
					if err != nil || response.StatusCode != http.StatusSwitchingProtocols {
						t.Fatalf("valid ticket rejected behind HTTPS proxy: %v", err)
					}
				} else if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
					t.Fatalf("missing, invalid or reused ticket was not rejected: %s %v", query, err)
				}
			}
		})
	}
}
