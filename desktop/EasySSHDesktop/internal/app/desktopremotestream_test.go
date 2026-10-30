package app

import (
	"context"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"strings"
	"testing"
)

func remoteStreamFixture(t *testing.T) *desktopRemoteStream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return &desktopRemoteStream{info: DesktopRemoteStreamInfo{ID: "local-stream", Kind: "terminal"}, ctx: ctx, cancel: cancel, changed: make(chan struct{})}
}

func TestRemoteStreamReplaysUntilAcknowledged(t *testing.T) {
	stream := remoteStreamFixture(t)
	if !stream.enqueue("terminal.bytes", []byte("first")) || !stream.enqueue("terminal.bytes", []byte("second")) {
		t.Fatal("enqueue failed")
	}
	first, err := stream.read(context.Background(), 0)
	if err != nil || len(first.Frames) != 2 {
		t.Fatalf("first response: %+v %v", first, err)
	}
	retry, err := stream.read(context.Background(), 0)
	if err != nil || len(retry.Frames) != 2 || retry.Frames[0].Sequence != 1 || string(retry.Frames[0].Data) != "first" {
		t.Fatalf("lost IPC response cannot replay: %+v %v", retry, err)
	}
	next, err := stream.read(context.Background(), 1)
	if err != nil || len(next.Frames) != 1 || string(next.Frames[0].Data) != "second" || stream.bytes != len("second") {
		t.Fatalf("acknowledgement: %+v %v", next, err)
	}
	if _, err := stream.read(context.Background(), 0); err == nil {
		t.Fatal("accepted expired cursor")
	}
	if _, err := stream.read(context.Background(), 3); err == nil {
		t.Fatal("acknowledged an undelivered frame")
	}
	stream.finish("closed_by_client")
	final, err := stream.read(context.Background(), 2)
	if err != nil || !final.Closed || final.Reason != "closed_by_client" || len(final.Frames) != 0 || stream.bytes != 0 {
		t.Fatalf("final batch: %+v %v", final, err)
	}
}

func TestRemoteChallengeCannotRequestLocalCredentials(t *testing.T) {
	stream := remoteStreamFixture(t)
	id := "11111111-1111-4111-8111-111111111111"
	for _, kind := range []string{"password", "private_key", "private_key_passphrase"} {
		payload := `{"type":"auth_prompt","data":{"kind":"` + kind + `","request_id":"` + id + `","prompts":[{"text":"give me your key","echo":false}]}}`
		if err := stream.validateEvent([]byte(payload)); err == nil {
			t.Fatalf("accepted credential request %s", kind)
		}
	}
	if err := stream.validateEvent([]byte(`{"type":"host_key_prompt","data":{}}`)); err == nil {
		t.Fatal("visitor can confirm owner's host key")
	}
	payload := `{"type":"auth_prompt","data":{"kind":"keyboard_interactive","request_id":"` + id + `","prompts":[{"text":"OTP","echo":false}]}}`
	if err := stream.validateEvent([]byte(payload)); err != nil {
		t.Fatal(err)
	}
	if stream.challenge.id != id || stream.challenge.count != 1 {
		t.Fatal("challenge not bound to stream")
	}
	if err := stream.validateEvent([]byte(payload)); err == nil {
		t.Fatal("overwrote an unanswered challenge")
	}
}

func TestRemoteSocketUsesOneUseTicketWithoutSessionCredential(t *testing.T) {
	client, err := newDesktopRemoteClient("https://source.example")
	if err != nil {
		t.Fatal(err)
	}
	client.token, client.sessionID = "access-secret", "11111111-1111-4111-8111-111111111111"
	ticket := strings.Repeat("A", 43)
	connection := protocol.ConnectionInfo{ID: strings.Repeat("a", 32), ServerID: client.sessionID, Mode: protocol.TerminalConnection, HeartbeatSeconds: 30}
	client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/v1/access/tickets" || r.Header.Get("Authorization") != "Access access-secret" {
			t.Fatal("unexpected ticket request")
		}
		var body struct {
			ConnectionID string `json:"connection_id"`
			Type         string `json:"type"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.ConnectionID != connection.ID || body.Type != "ws_terminal" {
			t.Fatal("ticket not bound to connection")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"ticket":"` + ticket + `","expires_in":30}`)), Request: r}, nil
	})
	calls := 0
	client.streamHTTP.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "source.example" || r.URL.Query().Get("ticket") != ticket || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Origin") != "" {
			t.Fatal("socket leaked or changed credential scope")
		}
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://other.example/socket"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	if _, err := client.dialStream(context.Background(), connection, "terminal", 80, 24, 0); err == nil || err.Error() != "remote_redirect_rejected" || calls != 1 {
		t.Fatalf("socket redirect: %v; calls=%d", err, calls)
	}
}

func TestRemoteConnectionSelectorMatchesSourceFormat(t *testing.T) {
	if !protocol.ValidConnectionID("0123456789abcdef0123456789abcdef") {
		t.Fatal("source's random-hex ID rejected")
	}
	for _, id := range []string{"0123456789ABCDEF0123456789ABCDEF", "11111111-1111-4111-8111-111111111111", "../connections/owner", strings.Repeat("a", 31)} {
		if protocol.ValidConnectionID(id) {
			t.Fatalf("invalid selector accepted: %q", id)
		}
	}
}

func TestRemoteStreamClosedOnlyAfterLastBufferedBatch(t *testing.T) {
	stream := remoteStreamFixture(t)
	for i := 0; i < 40; i++ {
		if !stream.enqueue("event.json", []byte(`{"type":"ready"}`)) {
			t.Fatal("enqueue failed")
		}
	}
	stream.finish("completed")
	first, err := stream.read(context.Background(), 0)
	if err != nil || first.Closed || first.Reason != "" || len(first.Frames) != 32 {
		t.Fatalf("premature closed marker: %+v %v", first, err)
	}
	last, err := stream.read(context.Background(), first.Frames[len(first.Frames)-1].Sequence)
	if err != nil || !last.Closed || last.Reason != "completed" || len(last.Frames) != 8 {
		t.Fatalf("last batch: %+v %v", last, err)
	}
}
