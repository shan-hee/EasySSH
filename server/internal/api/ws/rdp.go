package ws

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/rdp"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type RDPHandler struct {
	service *rdp.Service
	gateway *rdp.Gateway
	records operationrecord.Service
}

func NewRDPHandler(service *rdp.Service, gateway *rdp.Gateway, records operationrecord.Service) *RDPHandler {
	return &RDPHandler{service: service, gateway: gateway, records: records}
}
func (h *RDPHandler) Connect(c *gin.Context) {
	if !h.gateway.Configured() {
		c.AbortWithStatusJSON(503, gin.H{"error": "rdp_gateway_not_configured"})
		return
	}
	id, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		c.AbortWithStatus(400)
		return
	}
	lease, err := access.OpenStream(c.Request.Context(), access.Requirement{Action: protocol.RDPConnect, ServerID: id.String()})
	if err != nil {
		c.AbortWithStatus(403)
		return
	}
	defer lease.Close(nil)
	ctx := lease.Context()
	cfg, host, err := h.service.Target(ctx, id)
	if err != nil {
		c.AbortWithStatusJSON(409, gin.H{"error": "rdp_unavailable"})
		return
	}
	upgrader := ticketUpgrader(c, "easyssh-rdp-v1")
	socket, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer socket.Close()
	stopSocket := context.AfterFunc(ctx, func() { _ = socket.Close() })
	defer stopSocket()
	fail := func() {
		_ = socket.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1011, "RDP connection failed"), time.Now().Add(time.Second))
	}
	// The first frame is the only credential-bearing message. Never log or persist it.
	socket.SetReadLimit(16 << 10)
	_ = socket.SetReadDeadline(time.Now().Add(30 * time.Second))
	kind, body, err := socket.ReadMessage()
	if err != nil || kind != websocket.TextMessage {
		fail()
		return
	}
	var creds rdp.Credentials
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&creds) != nil || !creds.Valid() {
		clear(body)
		fail()
		return
	}
	clear(body)
	remote, err := h.gateway.Dial(ctx)
	if err != nil {
		fail()
		return
	}
	defer remote.Close()
	stopRemote := context.AfterFunc(ctx, func() { _ = remote.Close() })
	defer stopRemote()
	_ = remote.SetDeadline(time.Now().Add(30 * time.Second))
	// Audit before dispatching credentials or remote input.
	now := time.Now().UTC()
	recordID := uuid.New()
	record := &operationrecord.OperationRecord{ID: recordID, WorkID: recordID, Actor: access.Current(ctx).Actor(), Type: operationrecord.TypeConnection, Action: "rdp_session", Status: operationrecord.StatusRunning, ServerID: &id, Title: "RDP gateway session", DetailJSON: `{"protocol":"rdp","gateway":"guacd","layer":"transport"}`, Source: "manual", SourceTable: "rdp_sessions", SourceID: recordID.String(), CreatedAt: now, StartedAt: &now, IP: c.ClientIP(), TotalCount: 1}
	if err := h.records.Upsert(ctx, record); err != nil {
		fail()
		return
	}
	failed := false
	defer func() {
		end := time.Now().UTC()
		record.FinishedAt = &end
		record.DurationMs = end.Sub(now).Milliseconds()
		record.Status = operationrecord.StatusSuccess
		if record.EstablishedAt == nil || failed {
			record.Status = operationrecord.StatusFailure
		}
		if ctx.Err() != nil {
			record.Status = operationrecord.StatusCanceled
		}
		finish, done := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer done()
		_ = h.records.Upsert(finish, record)
	}()
	reader, connectionID, err := rdp.Handshake(remote, cfg, host, creds)
	creds = rdp.Credentials{}
	if err != nil {
		fail()
		return
	}
	_ = remote.SetDeadline(time.Time{})
	established := time.Now().UTC()
	record.EstablishedAt = &established
	_ = socket.SetWriteDeadline(time.Now().Add(15 * time.Second))
	if socket.WriteJSON([]string{"", connectionID}) != nil {
		return
	}
	socket.SetReadLimit(rdp.MaxInstructionBytes)
	_ = socket.SetReadDeadline(time.Now().Add(75 * time.Second))
	socket.SetPongHandler(func(string) error { return socket.SetReadDeadline(time.Now().Add(75 * time.Second)) })
	streamCtx, stop := context.WithCancel(ctx)
	defer stop()
	inputDone := make(chan struct{})
	go func() {
		defer close(inputDone)
		defer remote.Close()
		defer socket.Close()
		for {
			kind, body, err := socket.ReadMessage()
			if err != nil || kind != websocket.TextMessage {
				return
			}
			var v []string
			if json.Unmarshal(body, &v) != nil || !rdp.ValidClientInstruction(v) {
				return
			}
			_ = remote.SetWriteDeadline(time.Now().Add(15 * time.Second))
			if _, err := io.WriteString(remote, rdp.EncodeInstruction(v...)); err != nil {
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
	for {
		v, err := rdp.ReadInstruction(reader)
		if err != nil {
			break
		}
		_ = socket.SetWriteDeadline(time.Now().Add(15 * time.Second))
		if len(v) > 0 && v[0] == "error" {
			failed = true
		}
		if socket.WriteJSON(v) != nil {
			break
		}
	}
	stop()
	_ = remote.Close()
	_ = socket.Close()
	<-inputDone
	<-pingDone
}
