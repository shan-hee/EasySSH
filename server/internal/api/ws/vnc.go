package ws

import (
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/domain/vnc"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type VNCHandler struct {
	service  *vnc.Service
	security security.Service
	devPort  int
	records  operationrecord.Service
}

func NewVNCHandler(service *vnc.Service, security security.Service, devPort int, records operationrecord.Service) *VNCHandler {
	return &VNCHandler{service: service, security: security, devPort: devPort, records: records}
}

func (h *VNCHandler) Connect(c *gin.Context) {
	id, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		c.AbortWithStatus(400)
		return
	}
	lease, err := access.OpenStream(c.Request.Context(), access.Requirement{Action: protocol.VNCConnect, ServerID: id.String()})
	if err != nil {
		c.AbortWithStatus(403)
		return
	}
	defer lease.Close(nil)
	ctx := lease.Context()
	cfg, host, err := h.service.Target(ctx, id)
	if err != nil {
		c.AbortWithStatusJSON(409, gin.H{"error": "vnc_unavailable"})
		return
	}
	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	address := net.JoinHostPort(host, strconv.Itoa(cfg.Port))
	var remote net.Conn
	if cfg.TLS {
		remote, err = (&tls.Dialer{NetDialer: dialer, Config: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}}).DialContext(dialCtx, "tcp", address)
	} else {
		remote, err = dialer.DialContext(dialCtx, "tcp", address)
	}
	if err != nil {
		c.AbortWithStatusJSON(502, gin.H{"error": "vnc_connection_failed"})
		return
	}
	defer remote.Close()
	stopRemote := context.AfterFunc(ctx, func() { _ = remote.Close() })
	defer stopRemote()
	upgrader := websocket.Upgrader{Subprotocols: []string{"binary"}, CheckOrigin: func(r *http.Request) bool { return middleware.IsAllowedOrigin(r, h.security, h.devPort) }}
	// Persist attribution before allowing any remote input.
	now := time.Now().UTC()
	recordID := uuid.New()
	record := &operationrecord.OperationRecord{ID: recordID, WorkID: recordID, Actor: access.Current(ctx).Actor(), Type: operationrecord.TypeConnection, Action: "vnc_session", Status: operationrecord.StatusRunning, ServerID: &id, Title: "VNC transport session", DetailJSON: `{"protocol":"vnc","layer":"transport"}`, Source: "manual", SourceTable: "vnc_sessions", SourceID: recordID.String(), CreatedAt: now, StartedAt: &now, IP: c.ClientIP(), TotalCount: 1}
	if err := h.records.Upsert(ctx, record); err != nil {
		c.AbortWithStatus(503)
		return
	}
	defer func() {
		end := time.Now().UTC()
		record.FinishedAt = &end
		record.DurationMs = end.Sub(now).Milliseconds()
		record.Status = operationrecord.StatusSuccess
		if record.EstablishedAt == nil {
			record.Status = operationrecord.StatusFailure
		}
		if ctx.Err() != nil {
			record.Status = operationrecord.StatusCanceled
		}
		finishCtx, done := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer done()
		_ = h.records.Upsert(finishCtx, record)
	}()
	socket, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer socket.Close()
	record.EstablishedAt = &now
	stopSocket := context.AfterFunc(ctx, func() { _ = socket.Close() })
	defer stopSocket()
	socket.SetReadLimit(1 << 20)
	_ = socket.SetReadDeadline(time.Now().Add(75 * time.Second))
	socket.SetPongHandler(func(string) error { return socket.SetReadDeadline(time.Now().Add(75 * time.Second)) })
	streamCtx, stop := context.WithCancel(ctx)
	defer stop()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer remote.Close()
		defer socket.Close()
		for {
			kind, reader, err := socket.NextReader()
			if err != nil {
				return
			}
			if kind != websocket.BinaryMessage {
				return
			}
			_ = remote.SetWriteDeadline(time.Now().Add(15 * time.Second))
			if _, err := io.Copy(remote, reader); err != nil {
				return
			}
		}
	}()
	pingDone := make(chan struct{})
	go func() {
		defer close(pingDone)
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-streamCtx.Done():
				return
			case <-ticker.C:
				if socket.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					_ = remote.Close()
					_ = socket.Close()
					return
				}
			}
		}
	}()
	buffer := make([]byte, 64<<10)
	for {
		n, err := remote.Read(buffer)
		if n > 0 {
			_ = socket.SetWriteDeadline(time.Now().Add(15 * time.Second))
			if socket.WriteMessage(websocket.BinaryMessage, buffer[:n]) != nil {
				break
			}
		}
		if err != nil {
			break
		}
	}
	stop()
	_ = socket.Close()
	_ = remote.Close()
	<-done
	<-pingDone
}
