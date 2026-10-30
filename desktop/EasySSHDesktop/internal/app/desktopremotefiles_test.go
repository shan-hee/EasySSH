package app

import (
	"context"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/easyssh/shared/sftputil"
)

func remoteFileFixture(t *testing.T, transport remoteRoundTripFunc) (*desktopRemoteSession, protocol.ConnectionInfo) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	connection := protocol.ConnectionInfo{ID: strings.Repeat("a", 32), ServerID: "11111111-1111-4111-8111-111111111111", Mode: protocol.FilesConnection, HeartbeatSeconds: 30}
	client := &desktopRemoteClient{origin: "https://source.example", token: "source-access-secret", sessionID: "22222222-2222-4222-8222-222222222222", slots: make(chan struct{}, 8), http: &http.Client{Transport: transport}}
	return &desktopRemoteSession{ctx: ctx, cancel: cancel, client: client, connections: map[string]protocol.ConnectionInfo{connection.ID: connection}, streams: make(map[string]*desktopRemoteStream)}, connection
}

func TestRemoteFileUsesNativeConnectionAndEncodesPathAsData(t *testing.T) {
	remotePath := "/notes ?ticket=wrong&server_id=other#fragment\\draft "
	calls := 0
	session, connection := remoteFileFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "source.example" || r.URL.Path != "/api/v1/sftp/11111111-1111-4111-8111-111111111111/read" ||
			r.Header.Get("X-EasySSH-Connection") != strings.Repeat("a", 32) || r.Header.Get("Authorization") != "Access source-access-secret" ||
			r.Header.Get("Cookie") != "" || len(r.URL.Query()) != 1 || r.URL.Query().Get("path") != remotePath {
			t.Fatal("file request escaped its connection or query scope")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("data")), Request: r}, nil
	})
	var content []byte
	if err := session.requestFile(context.Background(), connection.ID, http.MethodGet, "read", url.Values{"path": {remotePath}}, nil, &content, true); err != nil || string(content) != "data" {
		t.Fatalf("read: %q %v", content, err)
	}
	if err := session.requestFile(context.Background(), strings.Repeat("b", 32), http.MethodGet, "read", nil, nil, &content, true); err == nil || calls != 1 {
		t.Fatal("unknown connection reached source")
	}
}

func TestRemoteReadLimitAndWriteDoesNotReplayOnFailure(t *testing.T) {
	mode := "read"
	calls := 0
	session, connection := remoteFileFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if mode == "read" {
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(strings.Repeat("x", sftputil.MaxTextFileBytes+1))), Request: r}, nil
		}
		var input struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || len(input.Content) != sftputil.MaxTextFileBytes {
			t.Fatal("write payload changed or old 2MiB cap remained")
		}
		return &http.Response{StatusCode: 503, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"write_failed","message":"private upstream detail"}`)), Request: r}, nil
	})
	var content []byte
	if err := session.requestFile(context.Background(), connection.ID, http.MethodGet, "read", nil, nil, &content, true); err == nil || len(content) != 0 {
		t.Fatal("oversized response accepted")
	}
	mode = "write"
	input := struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}{"/text", strings.Repeat("\x00", sftputil.MaxTextFileBytes)}
	var info protocol.FileInfo
	err := session.requestFile(context.Background(), connection.ID, http.MethodPost, "write", nil, input, &info, false)
	if err == nil || err.Error() != "remote_request_failed" || calls != 2 {
		t.Fatalf("write replayed or leaked source error: %v (%d calls)", err, calls)
	}
}

func TestRemoteFileAuthCannotBecomeTerminalOrCredentialImport(t *testing.T) {
	stream := remoteStreamFixture(t)
	stream.info.Kind = "sftp_auth"
	for _, event := range []string{`{"type":"output","data":"command"}`, `{"type":"connected","data":{}}`, `{"type":"host_key_prompt","data":{}}`, `{"type":"auth_prompt","data":{"kind":"password"}}`} {
		if err := stream.validateEvent([]byte(event)); err == nil {
			t.Fatalf("accepted unrelated auth event %s", event)
		}
	}
	if err := stream.validateEvent([]byte(`{"type":"status","data":{"status":"authenticating"}}`)); err != nil {
		t.Fatal(err)
	}
	if err := stream.validateEvent([]byte(`{"type":"authenticated","data":{"status":"authenticated"}}`)); err != nil || !stream.ready {
		t.Fatalf("authentication completion: %v", err)
	}
	if err := stream.validateEvent([]byte(`{"type":"status","data":{"status":"authenticating"}}`)); err == nil {
		t.Fatal("authentication restarted after completion")
	}
}

func TestRemoteFileAuthTicketIsBoundWithoutCredentialForwarding(t *testing.T) {
	client, err := newDesktopRemoteClient("https://source.example")
	if err != nil {
		t.Fatal(err)
	}
	defer client.close()
	client.token, client.sessionID = "private-session-token", "22222222-2222-4222-8222-222222222222"
	connection := protocol.ConnectionInfo{ID: strings.Repeat("a", 32), ServerID: "11111111-1111-4111-8111-111111111111", Mode: protocol.FilesConnection, HeartbeatSeconds: 30}
	ticket := strings.Repeat("A", 43)
	client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		var input struct {
			Type         string `json:"type"`
			ServerID     string `json:"server_id"`
			ConnectionID string `json:"connection_id"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || input.Type != "ws_sftp_auth" || input.ServerID != connection.ServerID || input.ConnectionID != connection.ID {
			t.Fatal("unbound file authentication ticket")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"ticket":"` + ticket + `","expires_in":30}`)), Request: r}, nil
	})
	calls := 0
	client.streamHTTP.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Path != "/api/v1/sftp/"+connection.ServerID+"/auth/ws" || r.URL.Query().Get("ticket") != ticket || len(r.URL.Query()) != 1 ||
			r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Origin") != "" {
			t.Fatal("file auth socket leaked credentials or changed endpoint")
		}
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://other.example/auth"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	if _, err := client.dialStream(context.Background(), connection, "sftp_auth", 0, 0, 0); err == nil || err.Error() != "remote_redirect_rejected" || calls != 1 {
		t.Fatalf("unexpected auth redirect result: %v (%d calls)", err, calls)
	}
}

func TestRemoteFilePathPreservesNamesAndRejectsAmbiguousTargets(t *testing.T) {
	for _, value := range []string{"/notes ", `/a\b`, "/a\nname", "/a?#b"} {
		if !validRemoteFilePath(value) {
			t.Fatalf("rejected valid POSIX path %q", value)
		}
	}
	for _, value := range []string{"", "relative", "/a/../b", "/a//b", "/a/", "/a\x00b"} {
		if validRemoteFilePath(value) {
			t.Fatalf("accepted ambiguous path %q", value)
		}
	}
}
