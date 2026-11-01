package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/coder/websocket"
)

// The caller supplies a window-owned logical connection, never an endpoint or
// ticket. Access credentials and ticket exchange stay in the native client.
func (s *DesktopRemoteWorkspaceService) OpenRemoteDesktop(ctx context.Context, connectionID, mode string) (DesktopRemoteStreamInfo, error) {
	if mode != "vnc" && mode != "rdp" {
		return DesktopRemoteStreamInfo{}, remoteError("invalid_connection_mode")
	}
	return s.openStream(ctx, connectionID, mode, 0, 0, 0)
}

func remoteDesktopFrameEncoding(mode string, kind websocket.MessageType, data []byte) (string, error) {
	if mode == "vnc" && kind == websocket.MessageBinary {
		return "vnc.bytes", nil
	}
	if mode == "rdp" && kind == websocket.MessageText {
		var instruction []string
		if json.Unmarshal(data, &instruction) == nil && len(instruction) > 0 {
			return "rdp.json", nil
		}
	}
	return "", remoteError("invalid_remote_desktop_message")
}

// RFB bytes and RDP JSON (including transient login credentials) are forwarded
// only to this window's existing stream, without logging or persistence.
func (s *DesktopRemoteWorkspaceService) WriteRemoteDesktop(ctx context.Context, id string, data []byte) error {
	defer clear(data)
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	stream, err := session.stream(id)
	if err != nil {
		return err
	}
	return stream.writeRemoteDesktop(ctx, data)
}

func (stream *desktopRemoteStream) writeRemoteDesktop(ctx context.Context, data []byte) error {
	if len(data) == 0 || len(data) > remoteStreamMessageLimit {
		return remoteError("invalid_remote_desktop_message")
	}
	kind := websocket.MessageBinary
	switch stream.info.Kind {
	case "vnc":
	case "rdp":
		if !json.Valid(data) {
			return remoteError("invalid_remote_desktop_message")
		}
		kind = websocket.MessageText
	default:
		return remoteError("invalid_stream_kind")
	}
	stream.mu.Lock()
	socket, closed := stream.socket, stream.closed
	stream.mu.Unlock()
	if closed || socket == nil {
		return remoteError("stream_unavailable")
	}
	writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := socket.Write(writeCtx, kind, data); err != nil {
		stream.finish("remote_write_failed")
		return remoteError("remote_write_failed")
	}
	return nil
}
