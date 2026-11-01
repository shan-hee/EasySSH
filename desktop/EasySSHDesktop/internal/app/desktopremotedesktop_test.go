package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/easyssh/shared/protocol"
)

func TestRemoteDesktopTicketAndStreamRoundTrip(t *testing.T) {
	for _, tc := range []struct {
		mode, subprotocol, input, output, encoding string
		connectionMode                             protocol.ConnectionMode
		messageType                                websocket.MessageType
	}{
		{"vnc", "binary", "RFB 003.008\n", "\x00\xff\x80RFB", "vnc.bytes", protocol.VNCConnection, websocket.MessageBinary},
		{"rdp", "easyssh-rdp-v1", `{"username":"visitor","password":"transient","width":1280,"height":720}`, `["name","桌面😀"]`, "rdp.json", protocol.RDPConnection, websocket.MessageText},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			connection := protocol.ConnectionInfo{ID: strings.Repeat("a", 32), ServerID: "11111111-1111-4111-8111-111111111111", Mode: tc.connectionMode, HeartbeatSeconds: 30}
			ticket := strings.Repeat("A", 43)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v1/access/tickets" {
					var input struct{ Type, ServerID, ConnectionID string }
					var raw map[string]string
					if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
						t.Error(err)
						w.WriteHeader(400)
						return
					}
					input.Type, input.ServerID, input.ConnectionID = raw["type"], raw["server_id"], raw["connection_id"]
					if input.Type != "ws_"+tc.mode || input.ServerID != connection.ServerID || input.ConnectionID != connection.ID || r.Header.Get("Authorization") != "Access source-secret" {
						t.Error("ticket did not use the native connection scope")
						w.WriteHeader(403)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"ticket": ticket, "expires_in": 30})
					return
				}
				if r.URL.Path != "/api/v1/"+tc.mode+"/"+connection.ServerID+"/ws" || r.URL.Query().Get("ticket") != ticket || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Origin") != "" {
					t.Error("desktop stream changed its endpoint or leaked session credentials")
					w.WriteHeader(403)
					return
				}
				socket, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{tc.subprotocol}})
				if err != nil {
					t.Error(err)
					return
				}
				defer socket.CloseNow()
				if socket.Subprotocol() != tc.subprotocol {
					t.Error("missing desktop subprotocol")
					return
				}
				kind, data, err := socket.Read(ctx)
				if err != nil || kind != tc.messageType || string(data) != tc.input {
					t.Error("desktop input was changed or dropped")
					return
				}
				if err := socket.Write(ctx, tc.messageType, []byte(tc.output)); err != nil {
					t.Error(err)
					return
				}
				// Keep the upstream open until the client has consumed the buffered frame.
				_, _, _ = socket.Read(ctx)
			}))
			defer server.Close()
			client, err := newDesktopRemoteClient(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer client.close()
			client.http, client.streamHTTP = server.Client(), server.Client()
			client.token, client.sessionID = "source-secret", connection.ServerID
			socket, err := client.dialStream(ctx, connection, tc.mode, 0, 0, 0)
			if err != nil {
				t.Fatal(err)
			}
			stream := remoteStreamFixture(t)
			stream.info.Kind, stream.connection, stream.socket = tc.mode, connection, socket
			stream.session = &desktopRemoteSession{connections: map[string]protocol.ConnectionInfo{connection.ID: connection}, streams: map[string]*desktopRemoteStream{stream.info.ID: stream}}
			finished := make(chan struct{})
			go func() { defer close(finished); stream.receive() }()
			defer func() { stream.finish("closed_by_client"); <-finished }()
			if err := stream.writeRemoteDesktop(ctx, []byte(tc.input)); err != nil {
				t.Fatal(err)
			}
			batch, err := stream.read(ctx, 0)
			if err != nil || len(batch.Frames) != 1 || batch.Frames[0].Encoding != tc.encoding || string(batch.Frames[0].Data) != tc.output {
				t.Fatalf("desktop output was changed or dropped: %+v %v", batch, err)
			}
			stream.finish("closed_by_client")
			<-finished
			if _, exists := stream.session.connections[connection.ID]; exists {
				t.Fatal("closed desktop stream retained its connection")
			}
		})
	}
}

func TestRemoteDesktopRejectsWrongFramesAndUnscopedCalls(t *testing.T) {
	for _, tc := range []struct {
		mode string
		kind websocket.MessageType
		data string
	}{
		{"vnc", websocket.MessageText, "RFB"},
		{"rdp", websocket.MessageBinary, `["sync","1"]`},
		{"rdp", websocket.MessageText, `{"type":"auth_prompt"}`},
		{"rdp", websocket.MessageText, `["sync",1]`},
		{"rdp", websocket.MessageText, `[]`},
	} {
		if _, err := remoteDesktopFrameEncoding(tc.mode, tc.kind, []byte(tc.data)); err == nil {
			t.Fatalf("accepted invalid %s frame", tc.mode)
		}
	}
	stream := remoteStreamFixture(t)
	if err := stream.writeRemoteDesktop(context.Background(), []byte("input")); err == nil {
		t.Fatal("desktop write accepted terminal stream")
	}
	stream.info.Kind = "rdp"
	for _, data := range [][]byte{nil, []byte("invalid json"), make([]byte, remoteStreamMessageLimit+1)} {
		if err := stream.writeRemoteDesktop(context.Background(), data); err == nil {
			t.Fatal("accepted invalid desktop input")
		}
	}
	service := newDesktopRemoteWorkspaceService(nil, &desktopNativeBoundary{})
	defer service.cancel()
	if _, err := service.OpenRemoteDesktop(context.Background(), strings.Repeat("a", 32), "vnc"); err == nil {
		t.Fatal("opened without native window provenance")
	}
	if err := service.WriteRemoteDesktop(context.Background(), "stream", []byte("input")); err == nil {
		t.Fatal("wrote without native window provenance")
	}
	typ := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	for _, method := range []string{"OpenRemoteDesktop", "WriteRemoteDesktop"} {
		if !desktopRemoteBindingAllowed(typ.PkgPath() + "." + typ.Name() + "." + method) {
			t.Fatalf("missing binding %s", method)
		}
	}
}
