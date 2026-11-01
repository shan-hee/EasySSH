package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/easyssh/shared/aiwire"
	"github.com/google/uuid"
)

const (
	remoteStreamMessageLimit = 1 << 20
	remoteStreamQueueLimit   = 2 << 20
	remoteStreamFrameLimit   = 256
	remoteStreamCountLimit   = 2 * desktopRemoteMaxConnections
)

type DesktopRemoteStreamInfo struct {
	ID           string `json:"id"`
	ConnectionID string `json:"connection_id"`
	Kind         string `json:"kind"`
}

type DesktopRemoteFrame struct {
	Sequence uint64 `json:"sequence"`
	Encoding string `json:"encoding"` // terminal.bytes, monitor.protobuf, event.json, ai.sse, vnc.bytes, or rdp.json
	Data     []byte `json:"data"`     // Wails JSON carries base64; never HTML or executable code
}

type DesktopRemoteStreamBatch struct {
	Frames []DesktopRemoteFrame `json:"frames"`
	Closed bool                 `json:"closed"`
	Reason string               `json:"reason,omitempty"`
}

type desktopRemoteChallenge struct {
	id      string
	count   int
	expires time.Time
}

type desktopRemoteStream struct {
	info                              DesktopRemoteStreamInfo
	connection                        protocol.ConnectionInfo
	session                           *desktopRemoteSession
	aiSessionID                       string
	ctx                               context.Context
	cancel                            context.CancelFunc
	mu                                sync.Mutex
	readMu                            sync.Mutex
	socket                            *websocket.Conn
	frames                            []DesktopRemoteFrame
	bytes                             int
	sequence, acknowledged, delivered uint64
	changed                           chan struct{}
	closed                            bool
	reason                            string
	closedAt                          time.Time
	ready                             bool
	challenge                         desktopRemoteChallenge
}

func (stream *desktopRemoteStream) signalLocked() {
	close(stream.changed)
	stream.changed = make(chan struct{})
}

func (stream *desktopRemoteStream) finish(reason string) {
	stream.mu.Lock()
	if stream.closed {
		stream.mu.Unlock()
		return
	}
	stream.closed, stream.reason, stream.closedAt = true, reason, time.Now()
	stream.challenge = desktopRemoteChallenge{}
	socket := stream.socket
	stream.signalLocked()
	stream.mu.Unlock()
	stream.cancel()
	if socket != nil {
		_ = socket.CloseNow()
	}
}

func (stream *desktopRemoteStream) expired() bool {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	return stream.closed && time.Since(stream.closedAt) > time.Minute
}

func (stream *desktopRemoteStream) enqueue(encoding string, data []byte) bool {
	deadline := time.NewTimer(30 * time.Second)
	defer deadline.Stop()
	for {
		stream.mu.Lock()
		if stream.closed {
			stream.mu.Unlock()
			return false
		}
		queueLimit := remoteStreamQueueLimit
		if stream.info.Kind == "ai_chat" {
			queueLimit = aiwire.MaxNativeResponseBytes + 16
		}
		if stream.bytes+len(data) <= queueLimit && len(stream.frames) < remoteStreamFrameLimit {
			stream.sequence++
			stream.frames = append(stream.frames, DesktopRemoteFrame{stream.sequence, encoding, data})
			stream.bytes += len(data)
			stream.signalLocked()
			stream.mu.Unlock()
			return true
		}
		changed := stream.changed
		stream.mu.Unlock()
		select {
		case <-changed:
		case <-stream.ctx.Done():
			return false
		case <-deadline.C:
			stream.finish("consumer_too_slow")
			return false
		}
	}
}

func (stream *desktopRemoteStream) receive() {
	defer func() {
		reason := "remote_stream_closed"
		stream.mu.Lock()
		if stream.info.Kind == "sftp_auth" && stream.ready {
			reason = "authenticated"
		}
		stream.mu.Unlock()
		stream.finish(reason)
		// Closing a primary stream also ends the source logical connection.
		if stream.info.Kind == "terminal" || stream.info.Kind == "vnc" || stream.info.Kind == "rdp" || (stream.info.Kind == "monitor" && stream.connection.Mode == protocol.MonitorConnection) {
			stream.session.dropConnection(stream.connection.ID)
		}
	}()
	stop := context.AfterFunc(stream.ctx, func() { _ = stream.socket.CloseNow() })
	defer stop()
	for {
		kind, data, err := stream.socket.Read(stream.ctx)
		if err != nil {
			return
		}
		encoding := "event.json"
		if stream.info.Kind == "vnc" || stream.info.Kind == "rdp" {
			var err error
			encoding, err = remoteDesktopFrameEncoding(stream.info.Kind, kind, data)
			if err != nil {
				stream.finish(err.Error())
				return
			}
		} else if kind == websocket.MessageBinary {
			if stream.info.Kind == "terminal" {
				encoding = "terminal.bytes"
			} else if stream.info.Kind == "monitor" {
				encoding = "monitor.protobuf"
			} else {
				stream.finish("invalid_remote_message")
				return
			}
		} else if kind == websocket.MessageText {
			if err := stream.validateEvent(data); err != nil {
				stream.finish(err.Error())
				return
			}
		} else {
			stream.finish("invalid_remote_message")
			return
		}
		if !stream.enqueue(encoding, data) {
			return
		}
	}
}

func (stream *desktopRemoteStream) validateEvent(data []byte) error {
	var event struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(data, &event) != nil {
		return remoteError("invalid_remote_message")
	}
	if stream.info.Kind == "monitor" {
		switch event.Type {
		case "handshake_complete", "ready", "pong", "error":
			if event.Type == "ready" {
				stream.mu.Lock()
				stream.ready = true
				stream.mu.Unlock()
			}
			return nil
		}
		return remoteError("invalid_remote_message")
	}
	if stream.info.Kind == "sftp_auth" {
		stream.mu.Lock()
		complete := stream.ready
		stream.mu.Unlock()
		if complete && event.Type != "pong" && event.Type != "error" {
			return remoteError("invalid_remote_message")
		}
		switch event.Type {
		case "status", "authenticated":
			var status struct {
				Status string `json:"status"`
			}
			if json.Unmarshal(event.Data, &status) != nil || (event.Type == "status" && status.Status != "authenticating") || (event.Type == "authenticated" && status.Status != "authenticated") {
				return remoteError("invalid_remote_message")
			}
			if event.Type == "authenticated" {
				stream.mu.Lock()
				stream.challenge = desktopRemoteChallenge{}
				stream.ready = true
				stream.mu.Unlock()
			}
			return nil
		case "handshake_complete", "pong", "error":
			return nil
		case "auth_prompt", "host_key_prompt": // share the strict interactive-challenge checks below
		default:
			return remoteError("invalid_remote_message")
		}
	}
	switch event.Type {
	case "handshake_complete", "connected", "pong", "error", "completion_data", "closed", "output":
		if event.Type == "connected" {
			stream.mu.Lock()
			stream.ready = true
			stream.mu.Unlock()
		}
		return nil
	case "host_key_prompt":
		return remoteError("source_owner_confirmation_required")
	case "auth_prompt":
		var prompt struct {
			RequestID   string `json:"request_id"`
			Kind        string `json:"kind"`
			Name        string `json:"name"`
			Instruction string `json:"instruction"`
			Prompts     []struct {
				Text string `json:"text"`
				Echo bool   `json:"echo"`
			} `json:"prompts"`
		}
		if json.Unmarshal(event.Data, &prompt) != nil || !validRemoteUUID(prompt.RequestID) || prompt.Kind != "keyboard_interactive" ||
			len(prompt.Prompts) < 1 || len(prompt.Prompts) > 32 || len(prompt.Name) > 1024 || len(prompt.Instruction) > 16384 {
			return remoteError("invalid_remote_challenge")
		}
		for _, question := range prompt.Prompts {
			if len(question.Text) > 16384 {
				return remoteError("invalid_remote_challenge")
			}
		}
		stream.mu.Lock()
		defer stream.mu.Unlock()
		if stream.closed || stream.challenge.id != "" {
			return remoteError("invalid_remote_challenge")
		}
		stream.challenge = desktopRemoteChallenge{prompt.RequestID, len(prompt.Prompts), time.Now().Add(2 * time.Minute)}
		return nil
	default:
		return remoteError("invalid_remote_message")
	}
}

func (c *desktopRemoteClient) dialStream(ctx context.Context, connection protocol.ConnectionInfo, kind string, cols, rows, interval int) (*websocket.Conn, error) {
	var ticket struct {
		Ticket    string `json:"ticket"`
		ExpiresIn int    `json:"expires_in"`
	}
	var ticketType, path string
	var subprotocols []string
	query := url.Values{}
	switch kind {
	case "terminal":
		ticketType, path = "ws_terminal", "/api/v1/ssh/terminal/"+connection.ServerID
		query.Set("cols", strconv.Itoa(cols))
		query.Set("rows", strconv.Itoa(rows))
	case "monitor":
		ticketType, path = "ws_monitor", "/api/v1/monitor/server/"+connection.ServerID
		query.Set("interval", strconv.Itoa(interval))
	case "sftp_auth":
		ticketType, path = "ws_sftp_auth", "/api/v1/sftp/"+connection.ServerID+"/auth/ws"
	case "vnc":
		ticketType, path = "ws_vnc", "/api/v1/vnc/"+connection.ServerID+"/ws"
		subprotocols = []string{"binary"}
	case "rdp":
		ticketType, path = "ws_rdp", "/api/v1/rdp/"+connection.ServerID+"/ws"
		subprotocols = []string{"easyssh-rdp-v1"}
	default:
		return nil, remoteError("invalid_stream_kind")
	}
	err := c.request(ctx, http.MethodPost, "/api/v1/access/tickets", struct {
		Type         string `json:"type"`
		ServerID     string `json:"server_id"`
		ConnectionID string `json:"connection_id"`
	}{ticketType, connection.ServerID, connection.ID}, &ticket, true)
	if err != nil {
		return nil, err
	}
	decoded, err := base64.RawURLEncoding.DecodeString(ticket.Ticket)
	if err != nil || len(decoded) != 32 || ticket.ExpiresIn < 1 || ticket.ExpiresIn > 60 {
		return nil, remoteError("invalid_remote_response")
	}
	query.Set("ticket", ticket.Ticket)
	endpoint := strings.Replace(c.origin, "https://", "wss://", 1)
	endpoint = strings.Replace(endpoint, "http://", "ws://", 1)
	dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	// This private dial only carries a one-use ticket, not the access-session
	// token, cookies, Origin, callbacks or a renderer-controlled endpoint.
	conn, response, err := websocket.Dial(dialCtx, endpoint+path+"?"+query.Encode(), &websocket.DialOptions{HTTPClient: c.streamHTTP, CompressionMode: websocket.CompressionDisabled, Subprotocols: subprotocols})
	if err != nil {
		if response != nil && response.StatusCode >= 300 && response.StatusCode < 400 {
			return nil, remoteError("remote_redirect_rejected")
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, remoteError("remote_stream_unavailable")
	}
	conn.SetReadLimit(remoteStreamMessageLimit)
	return conn, nil
}

func (s *DesktopRemoteWorkspaceService) openStream(ctx context.Context, id, kind string, cols, rows, interval int) (DesktopRemoteStreamInfo, error) {
	if !protocol.ValidConnectionID(id) {
		return DesktopRemoteStreamInfo{}, remoteError("invalid_connection_id")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteStreamInfo{}, err
	}
	defer done()
	if err := session.beginOpening(); err != nil {
		return DesktopRemoteStreamInfo{}, err
	}
	defer session.opening.Done()
	connection, err := session.connection(id)
	if err != nil {
		return DesktopRemoteStreamInfo{}, err
	}
	if (kind == "terminal" && connection.Mode != protocol.TerminalConnection) ||
		(kind == "vnc" && connection.Mode != protocol.VNCConnection) ||
		(kind == "rdp" && connection.Mode != protocol.RDPConnection) {
		return DesktopRemoteStreamInfo{}, remoteError("invalid_connection_mode")
	}
	streamCtx, cancel := context.WithCancel(session.ctx)
	stream := &desktopRemoteStream{info: DesktopRemoteStreamInfo{uuid.NewString(), id, kind}, connection: connection, session: session,
		ctx: streamCtx, cancel: cancel, changed: make(chan struct{})}
	session.resourcesMu.Lock()
	if session.stopping || len(session.streams) >= remoteStreamCountLimit {
		session.resourcesMu.Unlock()
		cancel()
		return DesktopRemoteStreamInfo{}, remoteError("local_stream_capacity")
	}
	for _, existing := range session.streams {
		existing.mu.Lock()
		active := !existing.closed
		existing.mu.Unlock()
		if active && existing.info.ConnectionID == id && existing.info.Kind == kind {
			session.resourcesMu.Unlock()
			cancel()
			return DesktopRemoteStreamInfo{}, remoteError("stream_already_open")
		}
	}
	session.streams[stream.info.ID] = stream
	session.resourcesMu.Unlock()
	conn, err := session.client.dialStream(ctx, connection, kind, cols, rows, interval)
	if err != nil {
		stream.finish("stream_open_failed")
		session.resourcesMu.Lock()
		delete(session.streams, stream.info.ID)
		session.resourcesMu.Unlock()
		return DesktopRemoteStreamInfo{}, err
	}
	stream.mu.Lock()
	if stream.closed || streamCtx.Err() != nil || ctx.Err() != nil {
		stream.mu.Unlock()
		_ = conn.CloseNow()
		stream.finish("stream_open_cancelled")
		return DesktopRemoteStreamInfo{}, remoteError("stream_open_cancelled")
	}
	stream.socket = conn
	stream.ready = kind == "vnc" || kind == "rdp"
	stream.mu.Unlock()
	if kind == "sftp_auth" {
		// Start with no credential fields. Only source-held SSH credentials and
		// actual keyboard-interactive challenges may be used by a visitor.
		if err := stream.send(ctx, "auth_start", struct{}{}); err != nil {
			stream.finish("authentication_start_failed")
			return DesktopRemoteStreamInfo{}, err
		}
	}
	session.opening.Add(1)
	go func() { defer session.opening.Done(); stream.receive() }()
	return stream.info, nil
}

func (s *DesktopRemoteWorkspaceService) OpenTerminal(ctx context.Context, id string, cols, rows int) (DesktopRemoteStreamInfo, error) {
	if cols < 1 || cols > 1000 || rows < 1 || rows > 1000 {
		return DesktopRemoteStreamInfo{}, remoteError("invalid_terminal_size")
	}
	return s.openStream(ctx, id, "terminal", cols, rows, 0)
}

func (s *DesktopRemoteWorkspaceService) OpenMonitor(ctx context.Context, id string, interval int) (DesktopRemoteStreamInfo, error) {
	if interval < 1 || interval > 10 {
		return DesktopRemoteStreamInfo{}, remoteError("invalid_monitor_interval")
	}
	return s.openStream(ctx, id, "monitor", 0, 0, interval)
}

func (session *desktopRemoteSession) stream(id string) (*desktopRemoteStream, error) {
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	stream := session.streams[id]
	if stream == nil {
		return nil, remoteError("stream_unavailable")
	}
	return stream, nil
}

// ReadStream acknowledges processed frames and retains unacknowledged frames
// for retries of a lost IPC response. It never silently drops terminal output.
func (s *DesktopRemoteWorkspaceService) ReadStream(ctx context.Context, id string, after uint64) (DesktopRemoteStreamBatch, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteStreamBatch{}, err
	}
	defer done()
	stream, err := session.stream(id)
	if err != nil {
		return DesktopRemoteStreamBatch{}, err
	}
	return stream.read(ctx, after)
}

func (stream *desktopRemoteStream) read(ctx context.Context, after uint64) (DesktopRemoteStreamBatch, error) {
	if !stream.readMu.TryLock() {
		return DesktopRemoteStreamBatch{}, remoteError("stream_read_in_progress")
	}
	defer stream.readMu.Unlock()
	deadline := time.NewTimer(15 * time.Second)
	defer deadline.Stop()
	for {
		stream.mu.Lock()
		if after < stream.acknowledged || after > stream.delivered {
			stream.mu.Unlock()
			return DesktopRemoteStreamBatch{}, remoteError("invalid_stream_cursor")
		}
		removed := 0
		for removed < len(stream.frames) && stream.frames[removed].Sequence <= after {
			stream.bytes -= len(stream.frames[removed].Data)
			stream.frames[removed].Data = nil
			removed++
		}
		if removed > 0 {
			stream.frames = stream.frames[removed:]
			stream.acknowledged = after
			stream.signalLocked()
		}
		result := DesktopRemoteStreamBatch{Frames: make([]DesktopRemoteFrame, 0), Closed: stream.closed, Reason: stream.reason}
		bytes := 0
		for _, frame := range stream.frames {
			if len(result.Frames) >= 32 || bytes >= 256<<10 {
				break
			}
			result.Frames = append(result.Frames, frame)
			bytes += len(frame.Data)
			stream.delivered = frame.Sequence
		}
		result.Closed = stream.closed && len(result.Frames) == len(stream.frames)
		if !result.Closed {
			result.Reason = ""
		}
		changed := stream.changed
		stream.mu.Unlock()
		if len(result.Frames) > 0 || result.Closed {
			return result, nil
		}
		select {
		case <-ctx.Done():
			return DesktopRemoteStreamBatch{}, ctx.Err()
		case <-deadline.C:
			return result, nil
		case <-changed:
		}
	}
}

func (s *DesktopRemoteWorkspaceService) CloseStream(ctx context.Context, id string) error {
	session, _, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	stream, err := session.stream(id)
	if err != nil {
		return err
	}
	stream.finish("closed_by_client")
	return nil
}

func (stream *desktopRemoteStream) send(ctx context.Context, kind string, data any) error {
	stream.mu.Lock()
	socket, closed := stream.socket, stream.closed
	stream.mu.Unlock()
	if closed || socket == nil || (stream.info.Kind != "terminal" && stream.info.Kind != "sftp_auth") {
		return remoteError("stream_unavailable")
	}
	if stream.info.Kind == "sftp_auth" && kind != "auth_start" && kind != "auth_response" && kind != "ping" {
		return remoteError("invalid_file_auth_message")
	}
	encoded, err := json.Marshal(struct {
		Type string `json:"type"`
		Data any    `json:"data"`
	}{kind, data})
	if err != nil || len(encoded) > 128<<10 {
		return remoteError("invalid_terminal_message")
	}
	writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := socket.Write(writeCtx, websocket.MessageText, encoded); err != nil {
		stream.finish("remote_write_failed")
		return remoteError("remote_write_failed")
	}
	return nil
}

func (s *DesktopRemoteWorkspaceService) terminalStream(ctx context.Context, id string) (*desktopRemoteStream, context.Context, func(), error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	stream, err := session.stream(id)
	if err != nil || stream.info.Kind != "terminal" {
		done()
		return nil, nil, nil, remoteError("stream_unavailable")
	}
	return stream, ctx, done, nil
}

func (s *DesktopRemoteWorkspaceService) WriteTerminal(ctx context.Context, id, input string) error {
	if len(input) == 0 || len(input) > 64<<10 {
		return remoteError("invalid_terminal_input")
	}
	stream, ctx, done, err := s.terminalStream(ctx, id)
	if err != nil {
		return err
	}
	defer done()
	return stream.send(ctx, "input", struct {
		Data string `json:"data"`
	}{input})
}

func (s *DesktopRemoteWorkspaceService) ResizeTerminal(ctx context.Context, id string, cols, rows int) error {
	if cols < 1 || cols > 1000 || rows < 1 || rows > 1000 {
		return remoteError("invalid_terminal_size")
	}
	stream, ctx, done, err := s.terminalStream(ctx, id)
	if err != nil {
		return err
	}
	defer done()
	return stream.send(ctx, "resize", struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}{cols, rows})
}

func (s *DesktopRemoteWorkspaceService) AnswerTerminalChallenge(ctx context.Context, id, requestID string, answers []string, cancelled bool) error {
	stream, ctx, done, err := s.terminalStream(ctx, id)
	if err != nil {
		return err
	}
	defer done()
	return stream.answerChallenge(ctx, requestID, answers, cancelled)
}

func (stream *desktopRemoteStream) answerChallenge(ctx context.Context, requestID string, answers []string, cancelled bool) error {
	total := 0
	for _, answer := range answers {
		total += len(answer)
		if len(answer) > 16384 || strings.ContainsRune(answer, 0) {
			return remoteError("invalid_challenge_answer")
		}
	}
	if total > 64<<10 {
		return remoteError("invalid_challenge_answer")
	}
	stream.mu.Lock()
	challenge := stream.challenge
	if stream.closed || challenge.id == "" || challenge.id != requestID || !challenge.expires.After(time.Now()) || (!cancelled && len(answers) != challenge.count) || (cancelled && len(answers) != 0) {
		stream.mu.Unlock()
		return remoteError("invalid_challenge_answer")
	}
	stream.challenge = desktopRemoteChallenge{}
	stream.mu.Unlock()
	return stream.send(ctx, "auth_response", struct {
		RequestID string   `json:"request_id"`
		Answers   []string `json:"answers"`
		Cancelled bool     `json:"cancelled"`
	}{requestID, answers, cancelled})
}

func (s *DesktopRemoteWorkspaceService) RequestTerminalCompletion(ctx context.Context, id string, history, scripts bool) error {
	stream, ctx, done, err := s.terminalStream(ctx, id)
	if err != nil {
		return err
	}
	defer done()
	return stream.send(ctx, "fetch_completion_data", struct {
		History bool `json:"includeHistory"`
		Scripts bool `json:"includeScripts"`
	}{history, scripts})
}

func (stream *desktopRemoteStream) keepAlive(ctx context.Context) {
	stream.mu.Lock()
	socket, closed, ready := stream.socket, stream.closed, stream.ready
	backpressure := stream.bytes >= remoteStreamQueueLimit-remoteStreamMessageLimit || len(stream.frames) >= remoteStreamFrameLimit
	stream.mu.Unlock()
	if closed || socket == nil || backpressure {
		return
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if !ready {
		// Initial SSH connection may not yet read control pings. Application
		// ping keeps the transport active without requiring an early pong.
		if stream.info.Kind == "terminal" || stream.info.Kind == "sftp_auth" {
			_ = stream.send(pingCtx, "ping", struct {
				ID string `json:"id"`
				Ts int64  `json:"ts"`
			}{uuid.NewString(), time.Now().UnixMilli()})
		}
		return
	}
	if err := socket.Ping(pingCtx); err != nil {
		stream.finish("remote_ping_failed")
	}
}

func (s *DesktopRemoteWorkspaceService) PingTerminal(ctx context.Context, id string) (string, error) {
	stream, ctx, done, err := s.terminalStream(ctx, id)
	if err != nil {
		return "", err
	}
	defer done()
	pingID := uuid.NewString()
	if err := stream.send(ctx, "ping", struct {
		ID string `json:"id"`
		Ts int64  `json:"ts"`
	}{pingID, time.Now().UnixMilli()}); err != nil {
		return "", err
	}
	return pingID, nil
}
