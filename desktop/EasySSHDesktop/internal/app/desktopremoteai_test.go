package app

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"net/http/httptrace"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiwire"
	"github.com/google/uuid"
)

func remoteAIViewFixture(session *desktopRemoteSession, id string) protocol.AISessionOverview {
	now := time.Now().UTC()
	return protocol.AISessionOverview{ID: id, Actor: remoteActivityActor(session), Status: protocol.AISessionStatusIdle, PermissionMode: "balanced", CreatedAt: now, UpdatedAt: now, DefaultTransport: protocol.AISdkUI}
}
func TestRemoteAIHistoryPreservesSourceActorAndPagination(t *testing.T) {
	var response protocol.ListAISessionsResponse
	calls := 0
	session, task := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Path != "/api/v1/ai/sessions" || r.URL.Query().Get("page") != "3" || r.URL.Query().Get("limit") != "7" || r.URL.Query().Get("q") != "?actor=other&secret=value" || r.Header.Get("Authorization") != "Access source-access-secret" || r.Header.Get("Cookie") != "" {
			t.Fatal("AI history escaped source scope")
		}
		return remoteTaskResponse(t, r, response), nil
	})
	response = protocol.ListAISessionsResponse{Items: []protocol.AISessionListItem{{ID: task.ID.String(), Actor: task.Actor, Status: protocol.AISessionStatusIdle, PermissionMode: "balanced", CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt, MessageCount: 1}}, Total: 20}
	input := protocol.AIListInput{Page: 3, Limit: 7, Query: "?actor=other&secret=value"}
	if result, err := session.listRemoteAISessions(context.Background(), input); err != nil || len(result.Items) != 1 {
		t.Fatalf("history: %+v %v", result, err)
	}
	response.Items[0].Actor.GrantID = uuid.NewString()
	if _, err := session.listRemoteAISessions(context.Background(), input); err == nil {
		t.Fatal("foreign AI history exposed")
	}
	input.Limit = 101
	if _, err := session.listRemoteAISessions(context.Background(), input); err == nil || calls != 2 {
		t.Fatal("invalid history page dispatched")
	}
}
func TestRemoteAIMutationRejectsForeignOrUncertainResponse(t *testing.T) {
	var response protocol.CreateAISessionResponse
	session, _ := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) { return remoteTaskResponse(t, r, response), nil })
	id := uuid.NewString()
	view := remoteAIViewFixture(session, id)
	response = protocol.CreateAISessionResponse{SessionID: id, Session: &view, DefaultTransport: protocol.AISdkUI}
	path, _ := remoteAISessionPath(id)
	if _, err := session.remoteAIResponse(context.Background(), http.MethodGet, path, nil, id, false); err != nil {
		t.Fatal(err)
	}
	view.Actor.GrantID = uuid.NewString()
	if _, err := session.remoteAIResponse(context.Background(), http.MethodGet, path, nil, id, false); err == nil {
		t.Fatal("foreign actor accepted")
	}
	if _, err := session.remoteAIResponse(context.Background(), http.MethodPost, "/api/v1/ai/sessions", protocol.CreateAISessionRequest{}, "", true); err == nil || err.Error() != "ai_operation_outcome_unknown" {
		t.Fatalf("mutation receipt: %v", err)
	}
	if _, err := remoteAISessionPath("../owner"); err == nil {
		t.Fatal("path injection accepted")
	}
}
func TestRemoteAIResumeOnlyObservesAndPreservesSSE(t *testing.T) {
	id := uuid.NewString()
	session, _ := remoteTaskFixture(t, nil)
	view := remoteAIViewFixture(session, id)
	chunk, err := json.Marshal(map[string]any{"type": "data-session-snapshot", "data": view, "transient": true})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	session.client.streamHTTP = &http.Client{Transport: remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodGet || r.URL.Host != "source.example" || r.URL.Path != "/api/v1/ai/sessions/"+id+"/chat/stream" || r.Header.Get("Authorization") != "Access source-access-secret" || r.Header.Get("X-EasySSH-Access-Session") != session.client.sessionID || r.Header.Get("Cookie") != "" {
			t.Fatal("resume submitted work or escaped source")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}, "X-Vercel-Ai-Ui-Message-Stream": {"v1"}}, Body: io.NopCloser(strings.NewReader(": heartbeat\n\ndata: " + string(chunk) + "\n\ndata: [DONE]\n\n")), Request: r}, nil
	})}
	info, err := session.openRemoteAIStream(context.Background(), id, nil)
	if err != nil {
		t.Fatal(err)
	}
	waitRemoteAIOperations(t, session)
	stream, err := session.stream(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	batch, err := stream.read(context.Background(), 0)
	if err != nil || !batch.Closed || batch.Reason != "ai_stream_completed" || len(batch.Frames) != 2 || batch.Frames[0].Encoding != "ai.sse" || string(batch.Frames[0].Data) != "data: "+string(chunk)+"\n\n" || calls != 1 {
		t.Fatalf("resume: %+v %v calls=%d", batch, err, calls)
	}
}
func TestRemoteAIChatLostReceiptDoesNotReplay(t *testing.T) {
	session, _ := remoteTaskFixture(t, nil)
	calls := 0
	session.client.streamHTTP = &http.Client{Transport: remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/chat") {
			t.Fatal("invalid chat request")
		}
		if trace := httptrace.ContextClientTrace(r.Context()); trace != nil && trace.GotConn != nil {
			trace.GotConn(httptrace.GotConnInfo{})
		}
		return nil, errors.New("response lost")
	})}
	id := uuid.NewString()
	input := protocol.AISDKChatRequest{Messages: []aichatui.UIMessage{{ID: uuid.NewString(), Role: "user", Parts: []map[string]any{{"type": "text", "text": "hello"}}}}}
	if _, err := session.openRemoteAIStream(context.Background(), id, &input); err == nil || err.Error() != "ai_operation_outcome_unknown" || calls != 1 || len(session.streams) != 0 {
		t.Fatalf("lost receipt: %v calls=%d streams=%d", err, calls, len(session.streams))
	}
	input.ID = uuid.NewString()
	if _, err := session.openRemoteAIStream(context.Background(), id, &input); err == nil || calls != 1 {
		t.Fatal("different session body sent")
	}
}
func waitRemoteAIOperations(t *testing.T, session *desktopRemoteSession) {
	t.Helper()
	done := make(chan struct{})
	go func() { session.opening.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("AI receiver did not finish")
	}
}
func TestRemoteAIBindingsDoNotExposeLocalAIService(t *testing.T) {
	typ := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	prefix := typ.PkgPath() + "." + typ.Name() + "."
	for _, method := range []string{"RemoteAIConfig", "ListRemoteAISessions", "RemoteAIHistory", "GetRemoteAISession", "LatestRemoteAISession", "CreateRemoteAISession", "RenameRemoteAISession", "CancelRemoteAISession", "DeleteRemoteAISession", "UpdateRemoteAIMessage", "DeleteRemoteAIMessage", "GetRemoteAITaskFile", "OpenRemoteAIChat", "ResumeRemoteAIChat"} {
		if !desktopRemoteBindingAllowed(prefix + method) {
			t.Fatalf("missing AI binding %s", method)
		}
	}
	for _, method := range []string{"SetConfig", "ExecuteTool", "Request", "OpenURL"} {
		if desktopRemoteBindingAllowed(prefix + method) {
			t.Fatalf("unexpected native authority %s", method)
		}
	}
}

func TestRemoteAIStreamRejectsForeignSnapshotsAndTruncatedCompletion(t *testing.T) {
	session, _ := remoteTaskFixture(t, nil)
	id := uuid.NewString()
	view := remoteAIViewFixture(session, id)
	view.Actor.GrantID = uuid.NewString()
	payload, err := json.Marshal(map[string]any{"type": "data-session-snapshot", "data": view})
	if err != nil {
		t.Fatal(err)
	}
	for _, sample := range []struct {
		source, reason string
		frames         int
	}{
		{"data: " + string(payload) + "\n\n", "invalid_remote_message", 0},
		{"data: {\"type\":\"native-execute-command\"}\n\n", "invalid_remote_message", 0},
		{"data: {\"type\":\"start\"}\n\n", "ai_stream_interrupted", 1},
		{"data: {\"type\":\"start\"}", "ai_stream_interrupted", 0},
	} {
		stream := remoteStreamFixture(t)
		stream.info.Kind, stream.session, stream.aiSessionID = "ai_chat", session, id
		stream.receiveAI(io.NopCloser(strings.NewReader(sample.source)))
		batch, err := stream.read(context.Background(), 0)
		if err != nil || !batch.Closed || batch.Reason != sample.reason || len(batch.Frames) != sample.frames {
			t.Fatalf("stream: %+v %v", batch, err)
		}
	}
}
func TestRemoteAIStreamCancellationClosesHTTPBody(t *testing.T) {
	stream := remoteStreamFixture(t)
	stream.info.Kind = "ai_chat"
	reader, writer := io.Pipe()
	defer writer.Close()
	done := make(chan struct{})
	go func() { stream.receiveAI(reader); close(done) }()
	stream.cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancelled AI body read stayed blocked")
	}
}
func TestRemoteAIStreamRejectsOversizedRecordWithoutPartialFrame(t *testing.T) {
	stream := remoteStreamFixture(t)
	stream.info.Kind = "ai_chat"
	stream.receiveAI(io.NopCloser(strings.NewReader("data: " + strings.Repeat("x", aiwire.MaxNativeResponseBytes+64) + "\n\n")))
	batch, err := stream.read(context.Background(), 0)
	if err != nil || batch.Reason != "ai_stream_message_too_large" || len(batch.Frames) != 0 {
		t.Fatalf("oversized record leaked: %+v %v", batch, err)
	}
}

func TestRemoteAIClosedQueuesStillConsumeSlotsUntilAcknowledged(t *testing.T) {
	session, _ := remoteTaskFixture(t, nil)
	var retained *desktopRemoteStream
	for i := 0; i < remoteAIStreamLimit; i++ {
		stream := remoteStreamFixture(t)
		stream.info.ID, stream.info.Kind = uuid.NewString(), "ai_chat"
		stream.aiSessionID = uuid.NewString()
		if !stream.enqueue("ai.sse", []byte("data: [DONE]\n\n")) {
			t.Fatal("enqueue failed")
		}
		stream.finish("ai_stream_completed")
		session.streams[stream.info.ID] = stream
		retained = stream
	}
	if _, err := session.openRemoteAIStream(context.Background(), uuid.NewString(), nil); err == nil || err.Error() != "local_stream_capacity" {
		t.Fatalf("unacknowledged queues bypassed capacity: %v", err)
	}
	if _, err := retained.read(context.Background(), 0); err != nil {
		t.Fatal(err)
	}
	if _, err := retained.read(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	session.client.streamHTTP = &http.Client{Transport: remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}, "X-Vercel-Ai-Ui-Message-Stream": {"v1"}}, Body: io.NopCloser(strings.NewReader("data: [DONE]\n\n")), Request: r}, nil
	})}
	if _, err := session.openRemoteAIStream(context.Background(), uuid.NewString(), nil); err != nil {
		t.Fatalf("acknowledged slot not reclaimed: %v", err)
	}
	waitRemoteAIOperations(t, session)
}
