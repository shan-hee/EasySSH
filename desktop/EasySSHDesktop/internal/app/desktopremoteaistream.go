package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"io"
	"mime"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync/atomic"
	"time"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/aiwire"
	"github.com/google/uuid"
)

const remoteAIStreamLimit = 4

func remoteAIChatBody(id string, input protocol.AISDKChatRequest) ([]byte, error) {
	if input.ID != "" && input.ID != id || input.MessageID != "" && !remoteAIIdentifier(input.MessageID) || !validRemoteAIPermission(input.PermissionMode) || !validRemoteAIScope(input.Scope) || !remoteText(input.Model, 512) || len(input.ServerReferences) > 100 {
		return nil, remoteError("invalid_ai_message")
	}
	switch input.ReasoningEffort {
	case "", "low", "medium", "high", "xhigh", "max":
	default:
		return nil, remoteError("invalid_ai_message")
	}
	switch input.Mode {
	case "", "regenerate":
	default:
		return nil, remoteError("invalid_ai_message")
	}
	if err := aiprovider.ValidateAttachments(input.Attachments); err != nil {
		return nil, remoteError("invalid_ai_attachment")
	}
	payload, err := json.Marshal(input)
	if err != nil || len(payload) > aiwire.MaxChatRequestBytes {
		return nil, remoteError("invalid_ai_message")
	}
	return payload, nil
}

func (session *desktopRemoteSession) openRemoteAIStream(ctx context.Context, id string, input *protocol.AISDKChatRequest) (DesktopRemoteStreamInfo, error) {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return DesktopRemoteStreamInfo{}, err
	}
	method := http.MethodGet
	var payload []byte
	path += "/chat/stream"
	if input != nil {
		payload, err = remoteAIChatBody(id, *input)
		if err != nil {
			return DesktopRemoteStreamInfo{}, err
		}
		method, path = http.MethodPost, strings.TrimSuffix(path, "/stream")
	}
	if err := session.beginOpening(); err != nil {
		return DesktopRemoteStreamInfo{}, err
	}
	defer session.opening.Done()
	streamCtx, cancel := context.WithCancel(session.ctx)
	stream := &desktopRemoteStream{info: DesktopRemoteStreamInfo{ID: uuid.NewString(), Kind: "ai_chat"}, aiSessionID: id, session: session, ctx: streamCtx, cancel: cancel, changed: make(chan struct{})}
	session.resourcesMu.Lock()
	retained := 0
	duplicate := false
	for streamID, existing := range session.streams {
		existing.mu.Lock()
		ai := existing.info.Kind == "ai_chat"
		reclaim := ai && existing.closed && (len(existing.frames) == 0 || time.Since(existing.closedAt) > time.Minute)
		if ai && !reclaim {
			retained++
			duplicate = duplicate || !existing.closed && existing.aiSessionID == id
		}
		existing.mu.Unlock()
		if reclaim {
			delete(session.streams, streamID)
		}
	}
	// Closed, unacknowledged frames still occupy memory. Count them as slots
	// until acknowledged or expired rather than allowing repeated reconnects to
	// multiply the queue budget.
	if session.stopping || duplicate || retained >= remoteAIStreamLimit || len(session.streams) >= remoteStreamCountLimit {
		session.resourcesMu.Unlock()
		cancel()
		if duplicate {
			return DesktopRemoteStreamInfo{}, remoteError("stream_already_open")
		}
		return DesktopRemoteStreamInfo{}, remoteError("local_stream_capacity")
	}
	session.streams[stream.info.ID] = stream
	session.resourcesMu.Unlock()
	failed := true
	defer func() {
		if failed {
			stream.finish("stream_open_failed")
			session.resourcesMu.Lock()
			delete(session.streams, stream.info.ID)
			session.resourcesMu.Unlock()
		}
	}()
	// Caller cancellation governs only opening. Once returned, the stream belongs
	// to its native workspace and is closed explicitly or with that workspace.
	stopCaller := context.AfterFunc(ctx, cancel)
	defer stopCaller()
	openingDeadline := time.AfterFunc(30*time.Second, cancel)
	defer openingDeadline.Stop()
	var attempted atomic.Bool
	requestCtx := httptrace.WithClientTrace(streamCtx, &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { attempted.Store(true) }})
	req, err := http.NewRequestWithContext(requestCtx, method, session.client.origin+path, bytes.NewReader(payload))
	if err != nil {
		return DesktopRemoteStreamInfo{}, remoteError("invalid_ai_request")
	}
	if session.client.token == "" || session.client.sessionID == "" {
		return DesktopRemoteStreamInfo{}, remoteError("reauthorization_required")
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Access "+session.client.token)
	req.Header.Set("X-EasySSH-Access-Session", session.client.sessionID)
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := *session.client.streamHTTP
	client.Timeout = 0 // header opening and idle-body deadlines are separate
	client.Jar = nil
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		if input != nil && attempted.Load() {
			return DesktopRemoteStreamInfo{}, remoteError("ai_operation_outcome_unknown")
		}
		return DesktopRemoteStreamInfo{}, remoteError("remote_unavailable")
	}
	if response.StatusCode != http.StatusOK {
		defer response.Body.Close()
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 65537))
		if readErr != nil || len(body) > 65536 || response.StatusCode >= 300 && response.StatusCode < 400 {
			if input != nil {
				return DesktopRemoteStreamInfo{}, remoteError("ai_operation_outcome_unknown")
			}
			return DesktopRemoteStreamInfo{}, remoteError("invalid_remote_response")
		}
		err := remoteResponseError(body)
		if isRemoteAccessEnded(err) {
			session.cancel()
		}
		if input != nil && err.Error() == "remote_request_failed" {
			return DesktopRemoteStreamInfo{}, remoteError("ai_operation_outcome_unknown")
		}
		return DesktopRemoteStreamInfo{}, err
	}
	mediaType, _, parseErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if parseErr != nil || mediaType != "text/event-stream" || response.Header.Get("X-Vercel-AI-UI-Message-Stream") != "v1" {
		response.Body.Close()
		if input != nil {
			return DesktopRemoteStreamInfo{}, remoteError("ai_operation_outcome_unknown")
		}
		return DesktopRemoteStreamInfo{}, remoteError("invalid_remote_response")
	}
	openingDeadline.Stop()
	stopCaller()
	if ctx.Err() != nil || streamCtx.Err() != nil {
		response.Body.Close()
		if input != nil {
			return DesktopRemoteStreamInfo{}, remoteError("ai_operation_outcome_unknown")
		}
		return DesktopRemoteStreamInfo{}, remoteError("stream_open_cancelled")
	}
	session.opening.Add(1)
	go func() { defer session.opening.Done(); stream.receiveAI(response.Body) }()
	failed = false
	return stream.info, nil
}
func (s *DesktopRemoteWorkspaceService) OpenRemoteAIChat(ctx context.Context, id string, input protocol.AISDKChatRequest) (DesktopRemoteStreamInfo, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteStreamInfo{}, err
	}
	defer done()
	return session.openRemoteAIStream(ctx, id, &input)
}
func (s *DesktopRemoteWorkspaceService) ResumeRemoteAIChat(ctx context.Context, id string) (DesktopRemoteStreamInfo, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteStreamInfo{}, err
	}
	defer done()
	return session.openRemoteAIStream(ctx, id, nil)
}

func (stream *desktopRemoteStream) receiveAI(body io.ReadCloser) {
	defer body.Close()
	defer stream.finish("ai_stream_interrupted")
	stop := context.AfterFunc(stream.ctx, func() { _ = body.Close() })
	defer stop()
	idle := time.AfterFunc(45*time.Second, func() { stream.finish("ai_stream_idle_timeout") })
	defer idle.Stop()
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 4096), aiwire.MaxStreamChunkBytes+64)
	var data []byte
	dispatch := func() bool {
		if len(data) == 0 {
			return true
		}
		if err := stream.validateAIChunk(data); err != nil {
			stream.finish(err.Error())
			return false
		}
		frame := append([]byte("data: "), data...)
		frame = append(frame, '\n', '\n')
		if !stream.enqueue("ai.sse", frame) {
			return false
		}
		if bytes.Equal(data, []byte("[DONE]")) {
			stream.finish("ai_stream_completed")
			return false
		}
		data = nil
		return true
	}
	for scanner.Scan() {
		idle.Reset(45 * time.Second)
		line := scanner.Bytes()
		if len(line) == 0 {
			if !dispatch() {
				return
			}
			continue
		}
		if line[0] == ':' {
			continue
		}
		if !bytes.HasPrefix(line, []byte("data:")) {
			stream.finish("invalid_remote_message")
			return
		}
		value := bytes.TrimPrefix(line[5:], []byte(" "))
		if len(data)+len(value)+1 > aiwire.MaxStreamChunkBytes {
			stream.finish("ai_stream_message_too_large")
			return
		}
		if len(data) != 0 {
			data = append(data, '\n')
		}
		data = append(data, value...)
	}
	if errors.Is(scanner.Err(), bufio.ErrTooLong) {
		stream.finish("ai_stream_message_too_large")
	}
	// EOF without [DONE] is an interrupted observation, never proof of failure or
	// permission to replay the POST. Resume uses the source snapshot endpoint.
}
func (stream *desktopRemoteStream) validateAIChunk(data []byte) error {
	if bytes.Equal(data, []byte("[DONE]")) {
		return nil
	}
	var chunk struct {
		Type string          `json:"type"`
		ID   string          `json:"id"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(data, &chunk) != nil {
		return remoteError("invalid_remote_message")
	}
	switch chunk.Type {
	case "data-session", "data-session-snapshot":
		var view protocol.AISessionOverview
		if json.Unmarshal(chunk.Data, &view) != nil || !stream.session.validRemoteAIView(&view, stream.aiSessionID) || chunk.ID != "" && chunk.ID != stream.aiSessionID {
			return remoteError("invalid_remote_message")
		}
	case "data-history-changed":
		var change protocol.AIHistoryChange
		if json.Unmarshal(chunk.Data, &change) != nil || aiwire.ValidateHistoryChange(stream.aiSessionID, change) != nil {
			return remoteError("invalid_remote_message")
		}
	case "data-task-output-delta":
		var delta protocol.AITaskOutputDelta
		if json.Unmarshal(chunk.Data, &delta) != nil || aiwire.ValidateTaskOutputDelta(stream.aiSessionID, delta) != nil {
			return remoteError("invalid_remote_message")
		}
	case "data-workspace-task":
		var task struct {
			SessionID string            `json:"session_id"`
			Task      aichatui.TaskView `json:"task"`
		}
		if json.Unmarshal(chunk.Data, &task) != nil || task.SessionID != stream.aiSessionID || !validRemoteAITask(task.Task) {
			return remoteError("invalid_remote_message")
		}
	case "start", "start-step", "finish-step", "finish", "error", "text-start", "text-delta", "text-end", "reasoning-start", "reasoning-delta", "reasoning-end", "tool-input-available", "tool-approval-request", "tool-output-available", "tool-output-error", "tool-output-denied", "data-tool-status", "data-stopped-run":
		// These are inert AI SDK UI records. They never call a native tool or host URL.
	default:
		return remoteError("invalid_remote_message")
	}
	return nil
}
