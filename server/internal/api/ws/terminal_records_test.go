package ws

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type terminalRecordService struct {
	operationrecord.Service
	record *operationrecord.OperationRecord
	err    error
}

func (s *terminalRecordService) Upsert(_ context.Context, record *operationrecord.OperationRecord) error {
	s.record = record
	return s.err
}

type terminalRecordAuthority struct {
	testutil.AccessPolicy
	runtime *access.Runtime
}

func (terminalRecordAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func (a terminalRecordAuthority) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	return a.runtime.Reserve(ctx, scope, kind, 0, requirements...)
}

func TestTerminalRejectsConnectionWhenIntentCannotBeSaved(t *testing.T) {
	runtime := access.NewRuntime()
	defer runtime.Close()
	actor := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), terminalRecordAuthority{runtime: runtime})
	if err != nil {
		t.Fatal(err)
	}
	ctx := access.WithScope(context.Background(), scope)
	serverID := uuid.NewString()
	info, err := runtime.CreateConnection(ctx, scope, serverID, protocol.TerminalConnection)
	if err != nil {
		t.Fatal(err)
	}
	logical, err := runtime.Connection(ctx, scope, info.ID, serverID)
	if err != nil {
		t.Fatal(err)
	}
	// All SSH dependencies are deliberately absent: rejection must precede dial.
	handler := &TerminalHandler{operationRecords: &terminalRecordService{err: errors.New("database unavailable")}}
	router := gin.New()
	router.GET("/terminal/:server_id", func(c *gin.Context) {
		bound, release := logical.Bind(access.WithScope(c.Request.Context(), scope))
		defer release()
		c.Request = c.Request.WithContext(bound)
		handler.HandleSSH(c)
	})
	server := httptest.NewServer(router)
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/terminal/"+serverID, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var message Message
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatal(err)
	}
	if message.Type != "error" || !strings.Contains(string(message.Data), "connection_record_unavailable") {
		t.Fatalf("connection admitted without saved intent: %+v", message)
	}
}

func TestTerminalRecordPreservesConnectionFacts(t *testing.T) {
	service := &terminalRecordService{}
	handler := &TerminalHandler{operationRecords: service}
	start := time.Now().Add(-2 * time.Minute)
	established := start.Add(time.Minute)
	finished := established.Add(10 * time.Second)
	input := terminalOperationRecord{Actor: protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, ServerID: uuid.New(), SessionID: "connection", StartedAt: start, EstablishedAt: &established, FinishedAt: &finished, Status: operationrecord.StatusSuccess}
	if err := handler.upsertTerminalOperationRecord(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	record := service.record
	if record.DurationMs != 10000 || record.TotalCount != 1 || record.SuccessCount != 1 || record.FailureCount != 0 || record.SourceID != input.SessionID || record.EstablishedAt == nil {
		t.Fatalf("incorrect connection facts: %+v", record)
	}
	sentinel := errors.New("write failed")
	service.err = sentinel
	if err := handler.upsertTerminalOperationRecord(context.Background(), input); !errors.Is(err, sentinel) {
		t.Fatalf("storage failure swallowed: %v", err)
	}
	handler.operationRecords = nil
	if err := handler.upsertTerminalOperationRecord(context.Background(), input); err == nil {
		t.Fatal("missing storage was accepted")
	}
}
