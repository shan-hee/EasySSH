package rest

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"github.com/gin-gonic/gin"
)

const maxAIChatRequestBytes int64 = aiwire.MaxChatRequestBytes

type AISessionHandler struct {
	manager *runtime.Manager
}

func NewAISessionHandler(manager *runtime.Manager) *AISessionHandler {
	return &AISessionHandler{manager: manager}
}

type CreateAISessionRequest = protocol.CreateAISessionRequest

type CreateAISessionResponse = protocol.CreateAISessionResponse

type ListAISessionsResponse = protocol.ListAISessionsResponse

type AISDKChatRequest = protocol.AISDKChatRequest

type RenameAISessionRequest = protocol.RenameAISessionRequest

type UpdateAIMessageRequest = protocol.UpdateAIMessageRequest

func (h *AISessionHandler) ListSessions(c *gin.Context) {

	limit, offset := GetPaginationParams(c)
	items, total, err := h.manager.ListSessions(
		c.Request.Context(),
		strings.TrimSpace(c.Query("q")),
		limit,
		offset,
		runtime.SessionScope{
			Kind:              strings.TrimSpace(c.Query("scope_kind")),
			TerminalSessionID: strings.TrimSpace(c.Query("terminal_session_id")),
			ServerID:          strings.TrimSpace(c.Query("server_id")),
		},
	)
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondSuccess(c, ListAISessionsResponse{
		Items: items,
		Total: total,
	})
}

func (h *AISessionHandler) GetSession(c *gin.Context) {

	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		RespondError(c, http.StatusBadRequest, "invalid_session_id", "session_id is required")
		return
	}

	view, err := h.manager.GetOverview(c.Request.Context(), sessionID)
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondSuccess(c, CreateAISessionResponse{
		SessionID:        view.ID,
		Session:          view,
		DefaultTransport: view.DefaultTransport,
	})
}

func (h *AISessionHandler) GetTaskFile(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	file, err := h.manager.GetTaskFile(c.Request.Context(), c.Param("session_id"), c.Param("task_id"))
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}
	RespondSuccess(c, file)
}

func (h *AISessionHandler) GetLatestSession(c *gin.Context) {

	view, err := h.manager.GetLatestActiveSession(c.Request.Context())
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondSuccess(c, CreateAISessionResponse{
		SessionID:        view.ID,
		Session:          runtime.Overview(view),
		DefaultTransport: view.DefaultTransport,
	})
}

func (h *AISessionHandler) CreateSession(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)

	var req CreateAISessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	view, err := h.manager.CreateSession(c.Request.Context(), runtime.CreateSessionInput{
		Model:          req.Model,
		PermissionMode: req.PermissionMode,
		Scope:          req.Scope,
	})
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondCreated(c, CreateAISessionResponse{
		SessionID:        view.ID,
		Session:          runtime.Overview(view),
		DefaultTransport: view.DefaultTransport,
	})
}

func (h *AISessionHandler) Chat(c *gin.Context) {

	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		RespondError(c, http.StatusBadRequest, "invalid_session_id", "session_id is required")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAIChatRequestBytes)
	var req AISDKChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	action, err := resolveAISDKChatAction(req)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	events, unsubscribe, err := h.manager.Subscribe(c.Request.Context(), sessionID)
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}
	defer unsubscribe()

	switch action.kind {
	case "approval":
		confirmations := make([]runtime.ConfirmTaskInput, 0, len(action.approvals))
		for _, approval := range action.approvals {
			confirmations = append(confirmations, runtime.ConfirmTaskInput{
				TaskID:   approval.taskID,
				Decision: approval.decision,
				Reason:   approval.reason,
			})
		}
		if err := h.manager.ConfirmTasks(c.Request.Context(), sessionID, confirmations); err != nil {
			h.respondRuntimeError(c, err)
			return
		}
	case "message":
		if err := h.manager.SendUserMessageWithOptions(
			c.Request.Context(),
			sessionID,
			runtime.SendUserMessageInput{
				ReasoningEffort:  req.ReasoningEffort,
				MessageID:        req.MessageID,
				Content:          action.content,
				Attachments:      action.attachments,
				ServerReferences: req.ServerReferences,
				Context:          req.Context,
				Model:            req.Model,
				PermissionMode:   req.PermissionMode,
				Scope:            req.Scope,
			},
		); err != nil {
			h.respondRuntimeError(c, err)
			return
		}
	case "regenerate":
		if err := h.manager.RegenerateAfterUserMessage(
			c.Request.Context(),
			sessionID,
			action.messageID,
			runtime.SendUserMessageInput{
				ReasoningEffort: req.ReasoningEffort,
				Context:         req.Context,
				Model:           req.Model,
				PermissionMode:  req.PermissionMode,
				Scope:           req.Scope,
			},
		); err != nil {
			h.respondRuntimeError(c, err)
			return
		}
	default:
		RespondError(c, http.StatusBadRequest, "validation_error", "unsupported AI SDK chat request")
		return
	}

	writer, stop, err := startAIChatStream(c)
	defer stop()
	if err != nil {
		return
	}

	streamer := newAISDKUIMessageStreamer(writer, action.kind == "approval")
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprint(writer, ": heartbeat\n\n"); err != nil {
				return
			}
			if err := writer.FlushError(); err != nil {
				return
			}
		case event, ok := <-events:
			if !ok {
				_ = streamer.finish("stop")
				return
			}

			done, err := streamer.writeRuntimeEvent(event)
			if err != nil {
				return
			}
			if err := writer.FlushError(); err != nil {
				return
			}
			if done {
				return
			}
		}
	}
}

func startAIChatStream(c *gin.Context) (*aiStreamWriter, func(), error) {
	writer, stop := newAIStreamWriter(c.Request.Context(), c.Writer)
	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache, no-transform")
	writer.Header().Set("Connection", "keep-alive")
	writer.Header().Set("X-Vercel-AI-UI-Message-Stream", "v1")
	writer.Header().Set("X-Accel-Buffering", "no")
	writer.WriteHeader(http.StatusOK)
	return writer, stop, writer.FlushError()
}

// ResumeChat observes an existing run; it never submits messages or executes tools.
// Reconnects reload committed history and observe new progress. Live deltas are
// not a durable replay log; history changes identify successful commits.
func (h *AISessionHandler) ResumeChat(c *gin.Context) {
	sessionID := strings.TrimSpace(c.Param("session_id"))
	view, err := h.manager.GetOverview(c.Request.Context(), sessionID)
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	var events <-chan runtime.Event
	if view.Status != runtime.SessionStatusClosed {
		var unsubscribe func()
		events, unsubscribe, err = h.manager.Subscribe(c.Request.Context(), sessionID)
		if err != nil {
			h.respondRuntimeError(c, err)
			return
		}
		defer unsubscribe()
	}

	writer, stop, err := startAIChatStream(c)
	defer stop()
	if err != nil {
		return
	}
	streamer := newAISDKUIMessageStreamer(writer, false)
	var lastUpdated time.Time
	var lastStatus runtime.SessionStatus
	writeSnapshot := func() (bool, error) {
		// Read current state instead of replaying queued, possibly stale events.
		latest, err := h.manager.GetOverview(c.Request.Context(), sessionID)
		if err != nil {
			return true, err
		}
		if !latest.UpdatedAt.Equal(lastUpdated) || latest.Status != lastStatus {
			if err := streamer.writeChunk(map[string]interface{}{
				"type": "data-session-snapshot", "data": latest, "transient": true,
			}); err != nil {
				return true, err
			}
			lastUpdated, lastStatus = latest.UpdatedAt, latest.Status
		}
		done := latest.Status != runtime.SessionStatusRunning
		if done {
			if err := streamer.writeDone(); err != nil {
				return true, err
			}
		}
		if err := writer.FlushError(); err != nil {
			return true, err
		}
		return done, nil
	}
	if done, err := writeSnapshot(); done || err != nil {
		return
	}

	// Coalesce token bursts while retaining prompt updates for tools and completion.
	updates := time.NewTicker(250 * time.Millisecond)
	defer updates.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	dirty := false
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case event, ok := <-events:
			if !ok {
				_, _ = writeSnapshot()
				return
			}
			dirty = true
			if event.Type == runtime.EventHistoryChanged || event.Type == runtime.EventTaskCreated || event.Type == runtime.EventTaskUpdated || event.Type == runtime.EventAssistantDelta || event.Type == runtime.EventAssistantCompleted {
				if _, err := streamer.writeRuntimeEvent(event); err != nil {
					return
				}
				if err := writer.FlushError(); err != nil {
					return
				}
			}
			if event.Type == runtime.EventError && event.Error != nil {
				if err := streamer.writeChunk(map[string]interface{}{
					"type": "error", "errorText": event.Error.Message,
				}); err != nil {
					return
				}
				if err := writer.FlushError(); err != nil {
					return
				}
			}
			if event.Type == runtime.EventSessionCompleted {
				if done, err := writeSnapshot(); done || err != nil {
					return
				}
			}
		case <-updates.C:
			if dirty {
				dirty = false
				if done, err := writeSnapshot(); done || err != nil {
					return
				}
			}
		case <-heartbeat.C:
			// Reconcile even if a slow subscriber's event buffer overflowed.
			if done, err := writeSnapshot(); done || err != nil {
				return
			}
			if _, err := fmt.Fprint(writer, ": heartbeat\n\n"); err != nil {
				return
			}
			if err := writer.FlushError(); err != nil {
				return
			}
		}
	}
}

func (h *AISessionHandler) CancelSession(c *gin.Context) {

	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		RespondError(c, http.StatusBadRequest, "invalid_session_id", "session_id is required")
		return
	}

	if err := h.manager.CancelSession(c.Request.Context(), sessionID); err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondSuccess(c, protocol.AICancelled{Cancelled: true})
}

func (h *AISessionHandler) RenameSession(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)

	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		RespondError(c, http.StatusBadRequest, "invalid_session_id", "session_id is required")
		return
	}

	var req RenameAISessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	if err := h.manager.RenameSession(c.Request.Context(), sessionID, req.Title); err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondSuccess(c, protocol.AIUpdated{Updated: true})
}

func (h *AISessionHandler) DeleteSession(c *gin.Context) {

	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		RespondError(c, http.StatusBadRequest, "invalid_session_id", "session_id is required")
		return
	}

	if err := h.manager.DeleteSession(c.Request.Context(), sessionID); err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondNoContent(c)
}

func (h *AISessionHandler) UpdateMessage(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)

	sessionID := strings.TrimSpace(c.Param("session_id"))
	messageID := strings.TrimSpace(c.Param("message_id"))
	if sessionID == "" || messageID == "" {
		RespondError(c, http.StatusBadRequest, "invalid_message_id", "session_id and message_id are required")
		return
	}

	var req UpdateAIMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	view, err := h.manager.UpdateUserMessage(c.Request.Context(), sessionID, messageID, runtime.UpdateMessageInput{
		Content:          req.Content,
		ServerReferences: req.ServerReferences,
	})
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondSuccess(c, CreateAISessionResponse{
		SessionID:        view.ID,
		Session:          runtime.Overview(view),
		DefaultTransport: view.DefaultTransport,
	})
}

func (h *AISessionHandler) DeleteMessage(c *gin.Context) {

	sessionID := strings.TrimSpace(c.Param("session_id"))
	messageID := strings.TrimSpace(c.Param("message_id"))
	if sessionID == "" || messageID == "" {
		RespondError(c, http.StatusBadRequest, "invalid_message_id", "session_id and message_id are required")
		return
	}

	view, err := h.manager.DeleteMessage(c.Request.Context(), sessionID, messageID)
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}

	RespondSuccess(c, CreateAISessionResponse{
		SessionID:        view.ID,
		Session:          runtime.Overview(view),
		DefaultTransport: view.DefaultTransport,
	})
}

type aiSDKChatAction struct {
	kind        string
	content     string
	attachments []runtime.Attachment
	messageID   string
	approvals   []aiSDKChatApproval
}

type aiSDKChatApproval struct {
	taskID   string
	decision runtime.Decision
	reason   string
}

func resolveAISDKChatAction(req AISDKChatRequest) (aiSDKChatAction, error) {
	if approvals := approvalResponsesFromUIMessages(req.Messages); len(approvals) > 0 {
		return aiSDKChatAction{kind: "approval", approvals: approvals}, nil
	}

	if strings.EqualFold(strings.TrimSpace(req.Mode), "regenerate") {
		messageID := strings.TrimSpace(req.MessageID)
		if messageID == "" {
			return aiSDKChatAction{}, errors.New("message id is required")
		}
		return aiSDKChatAction{kind: "regenerate", messageID: messageID}, nil
	}

	content := latestUserMessageText(req.Messages)
	if content == "" && len(req.Attachments) == 0 {
		return aiSDKChatAction{}, errors.New("message content is required")
	}
	return aiSDKChatAction{kind: "message", content: content, attachments: req.Attachments}, nil
}

func latestUserMessageText(messages []runtime.UIMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		message := messages[i]
		if message.Role != "user" {
			if i == len(messages)-1 {
				return ""
			}
			continue
		}

		return strings.TrimSpace(uiMessageText(message))
	}
	return ""
}

func uiMessageText(message runtime.UIMessage) string {
	var builder strings.Builder
	for _, part := range message.Parts {
		if stringValue(part["type"]) != "text" {
			continue
		}
		builder.WriteString(stringValue(part["text"]))
	}
	return builder.String()
}

func approvalResponsesFromUIMessages(messages []runtime.UIMessage) []aiSDKChatApproval {
	if len(messages) == 0 {
		return nil
	}

	last := messages[len(messages)-1]
	if last.Role != "assistant" {
		return nil
	}

	approvals := make([]aiSDKChatApproval, 0)
	seen := make(map[string]bool)
	lastStepStart := -1
	for i, part := range last.Parts {
		if stringValue(part["type"]) == "step-start" {
			lastStepStart = i
		}
	}
	for i := len(last.Parts) - 1; i > lastStepStart; i-- {
		part := last.Parts[i]
		if !isToolPartType(stringValue(part["type"])) || stringValue(part["state"]) != "approval-responded" {
			continue
		}

		approval, ok := mapValue(part["approval"])
		if !ok {
			continue
		}
		taskID := strings.TrimSpace(stringValue(approval["id"]))
		approved, ok := boolValue(approval["approved"])
		if taskID == "" || !ok {
			continue
		}
		if seen[taskID] {
			continue
		}
		seen[taskID] = true

		decision := runtime.DecisionReject
		if approved {
			decision = runtime.DecisionConfirm
		}
		approvals = append(approvals, aiSDKChatApproval{taskID: taskID, decision: decision, reason: strings.TrimSpace(stringValue(approval["reason"]))})
	}

	for left, right := 0, len(approvals)-1; left < right; left, right = left+1, right-1 {
		approvals[left], approvals[right] = approvals[right], approvals[left]
	}
	return approvals
}

type aiSDKUIMessageStreamer struct {
	taskOutputs       map[string]string
	writer            http.ResponseWriter
	preserveMessageID bool
	started           bool
	finished          bool
	stepOpen          bool
	currentStepSource string
	assistantSources  map[string]bool
	textParts         map[string]*aiSDKTextPartState
	reasoningParts    map[string]*aiSDKTextPartState
	toolInputs        map[string]bool
	toolApprovals     map[string]bool
	toolOutputs       map[string]bool
}

type aiSDKTextPartState struct {
	started bool
	sent    int
	ended   bool
}

func newAISDKUIMessageStreamer(writer http.ResponseWriter, preserveMessageID bool) *aiSDKUIMessageStreamer {
	return &aiSDKUIMessageStreamer{
		writer:            writer,
		taskOutputs:       make(map[string]string),
		preserveMessageID: preserveMessageID,
		assistantSources:  make(map[string]bool),
		textParts:         make(map[string]*aiSDKTextPartState),
		reasoningParts:    make(map[string]*aiSDKTextPartState),
		toolInputs:        make(map[string]bool),
		toolApprovals:     make(map[string]bool),
		toolOutputs:       make(map[string]bool),
	}
}

func (s *aiSDKUIMessageStreamer) writeRuntimeEvent(event runtime.Event) (bool, error) {
	if event.Session != nil && (event.Type == runtime.EventError || event.Type == runtime.EventSessionCompleted) {
		if err := s.writeChunk(map[string]interface{}{"type": "data-session", "id": event.Session.ID, "data": runtime.Overview(event.Session), "transient": true}); err != nil {
			return false, err
		}
	}
	switch event.Type {
	case runtime.EventHistoryChanged:
		if event.History == nil {
			return false, nil
		}
		return false, s.writeChunk(map[string]interface{}{"type": "data-history-changed", "data": event.History, "transient": true})
	case runtime.EventSessionStarted:
		return false, nil
	case runtime.EventSessionUpdated:
		if event.Session == nil {
			return false, nil
		}
		return false, s.writeChunk(map[string]interface{}{
			"type":      "data-session",
			"id":        event.Session.ID,
			"data":      runtime.Overview(event.Session),
			"transient": true,
		})
	case runtime.EventAssistantDelta, runtime.EventAssistantCompleted:
		if event.UIMessage != nil {
			if err := s.writeAssistantSnapshot(*event.UIMessage); err != nil {
				return false, err
			}
		}
	case runtime.EventTaskCreated, runtime.EventTaskUpdated, runtime.EventConfirmationRequested, runtime.EventConfirmationResolved:
		if event.Task != nil {
			task := event.Task.Public()
			if err := aiwire.OutputDeltas(event.SessionID, task.ID, s.taskOutputs[task.ID], task.CommandOutput, func(delta protocol.AITaskOutputDelta) error {
				return s.writeChunk(map[string]interface{}{"type": "data-task-output-delta", "data": delta, "transient": true})
			}); err != nil {
				return false, err
			}
			s.taskOutputs[task.ID] = task.CommandOutput
			task.CommandOutput = ""
			fits, err := liveTaskFits(task)
			if err != nil {
				return false, err
			}
			if !fits {
				// Committed history carries the full result. The live event still
				// reports the state, so a large command does not look stuck.
				task.Result, task.Error = "", ""
				if fits, err = liveTaskFits(task); err != nil || !fits {
					return false, err
				}
			}
			if err := s.writeChunk(map[string]interface{}{"type": "data-workspace-task", "data": map[string]interface{}{"session_id": event.SessionID, "task": task}, "transient": true}); err != nil {
				return false, err
			}
			if err := s.writeTask(task); err != nil {
				return false, err
			}
		} else if event.UIMessage != nil {
			if err := s.writeToolUIMessage(*event.UIMessage); err != nil {
				return false, err
			}
		}
	case runtime.EventError:
		message := "AI session error"
		if event.Error != nil && strings.TrimSpace(event.Error.Message) != "" {
			message = event.Error.Message
		}
		if err := s.writeChunk(map[string]interface{}{"type": "error", "errorText": message}); err != nil {
			return false, err
		}
		if err := s.writeDone(); err != nil {
			return false, err
		}
		return true, nil
	case runtime.EventSessionCompleted:
		if err := s.finish("stop"); err != nil {
			return false, err
		}
		return true, nil
	}

	return false, nil
}

func (s *aiSDKUIMessageStreamer) writeAssistantSnapshot(message runtime.UIMessage) error {
	if err := s.ensureAssistantSource(message.ID); err != nil {
		return err
	}

	for _, part := range message.Parts {
		typeName := stringValue(part["type"])
		switch {
		case typeName == "text":
			partID := message.ID + ":text"
			if err := s.writeTextPart(s.textParts, "text", partID, stringValue(part["text"]), stringValue(part["state"]) == "done"); err != nil {
				return err
			}
		case typeName == "reasoning":
			partID := message.ID + ":reasoning"
			if err := s.writeTextPart(s.reasoningParts, "reasoning", partID, stringValue(part["text"]), stringValue(part["state"]) == "done"); err != nil {
				return err
			}
		case strings.HasPrefix(typeName, "data-"):
			chunk := map[string]interface{}{
				"type": typeName,
				"data": part["data"],
			}
			if id := stringValue(part["id"]); id != "" {
				chunk["id"] = id
			}
			if err := s.writeChunk(chunk); err != nil {
				return err
			}
		case isToolPartType(typeName):
			if err := s.writeToolPart(message.ID, part); err != nil {
				return err
			}
		}
	}

	return nil
}

func (s *aiSDKUIMessageStreamer) writeTextPart(parts map[string]*aiSDKTextPartState, kind, id, text string, done bool) error {
	if strings.TrimSpace(text) == "" && !done {
		return nil
	}

	state := parts[id]
	if state == nil {
		state = &aiSDKTextPartState{}
		parts[id] = state
	}

	if !state.started {
		if err := s.writeChunk(map[string]interface{}{"type": kind + "-start", "id": id}); err != nil {
			return err
		}
		state.started = true
	}

	for len(text) > state.sent {
		delta, _ := aiwire.NextTextChunk(text[state.sent:])
		if err := s.writeChunk(map[string]interface{}{
			"type":  kind + "-delta",
			"id":    id,
			"delta": delta,
		}); err != nil {
			return err
		}
		state.sent += len(delta)
	}

	if done && !state.ended {
		if err := s.writeChunk(map[string]interface{}{"type": kind + "-end", "id": id}); err != nil {
			return err
		}
		state.ended = true
	}

	return nil
}

// The inline history budget bounds a live task event; its hash is never sent.
func liveTaskFits(task runtime.TaskView) (bool, error) {
	item, err := aiwire.DescribeHistoryItem(task.ID, task)
	return len(item.Data) > 0, err
}

func (s *aiSDKUIMessageStreamer) writeTask(task runtime.TaskView) error {
	message := aichatui.TaskMessage(task)
	message.ID = coalesceString(task.AssistantMessageID, message.ID)
	return s.writeToolUIMessage(message)
}

func (s *aiSDKUIMessageStreamer) writeToolUIMessage(message runtime.UIMessage) error {
	if err := s.ensureAssistantSource(message.ID); err != nil {
		return err
	}

	for _, part := range message.Parts {
		if !isToolPartType(stringValue(part["type"])) {
			continue
		}
		return s.writeToolPart(message.ID, part)
	}

	return nil
}

func (s *aiSDKUIMessageStreamer) writeToolPart(messageID string, part map[string]interface{}) error {
	if err := s.ensureAssistantSource(messageID); err != nil {
		return err
	}

	toolCallID := stringValue(part["toolCallId"])
	if toolCallID == "" {
		return nil
	}

	toolName := stringValue(part["toolName"])
	if toolName == "" {
		toolName = strings.TrimPrefix(stringValue(part["type"]), "tool-")
	}
	if toolName == "" {
		toolName = "tool"
	}

	if !s.toolInputs[toolCallID] {
		chunk := map[string]interface{}{
			"type":       "tool-input-available",
			"toolCallId": toolCallID,
			"toolName":   toolName,
			"input":      defaultMap(part["input"]),
			"dynamic":    stringValue(part["type"]) == "dynamic-tool",
			"title":      coalesceString(stringValue(part["title"]), toolName),
		}
		if providerMetadata, ok := mapValue(part["callProviderMetadata"]); ok {
			chunk["providerMetadata"] = providerMetadata
		}
		if err := s.writeChunk(chunk); err != nil {
			return err
		}
		s.toolInputs[toolCallID] = true
	}

	switch stringValue(part["state"]) {
	case "approval-requested":
		approvalID := approvalIDFromPart(part)
		if approvalID != "" && !s.toolApprovals[approvalID] {
			if err := s.writeChunk(map[string]interface{}{
				"type":       "tool-approval-request",
				"approvalId": approvalID,
				"toolCallId": toolCallID,
			}); err != nil {
				return err
			}
			s.toolApprovals[approvalID] = true
		}
	case "output-available":
		key := toolCallID + ":output"
		if !s.toolOutputs[key] {
			if err := s.writeChunk(map[string]interface{}{
				"type":       "tool-output-available",
				"toolCallId": toolCallID,
				"output":     part["output"],
				"dynamic":    stringValue(part["type"]) == "dynamic-tool",
			}); err != nil {
				return err
			}
			s.toolOutputs[key] = true
		}
	case "output-error":
		key := toolCallID + ":error"
		if !s.toolOutputs[key] {
			if err := s.writeChunk(map[string]interface{}{
				"type":       "tool-output-error",
				"toolCallId": toolCallID,
				"errorText":  coalesceString(stringValue(part["errorText"]), "Tool execution failed"),
				"dynamic":    stringValue(part["type"]) == "dynamic-tool",
			}); err != nil {
				return err
			}
			s.toolOutputs[key] = true
		}
	case "output-denied":
		key := toolCallID + ":denied"
		if !s.toolOutputs[key] {
			if err := s.writeChunk(map[string]interface{}{
				"type":       "tool-output-denied",
				"toolCallId": toolCallID,
			}); err != nil {
				return err
			}
			s.toolOutputs[key] = true
		}
	}

	return nil
}

func (s *aiSDKUIMessageStreamer) ensureAssistantSource(messageID string) error {
	if err := s.ensureStarted(messageID); err != nil {
		return err
	}
	if err := s.ensureStep(messageID); err != nil {
		return err
	}
	if s.assistantSources[messageID] {
		return nil
	}
	s.assistantSources[messageID] = true
	return nil
}

func (s *aiSDKUIMessageStreamer) ensureStep(sourceID string) error {
	if strings.TrimSpace(sourceID) == "" {
		sourceID = "assistant"
	}
	if !s.stepOpen {
		if err := s.writeChunk(map[string]interface{}{"type": "start-step"}); err != nil {
			return err
		}
		s.stepOpen = true
		s.currentStepSource = sourceID
		return nil
	}
	if s.currentStepSource == sourceID {
		return nil
	}
	if err := s.writeChunk(map[string]interface{}{"type": "finish-step"}); err != nil {
		return err
	}
	if err := s.writeChunk(map[string]interface{}{"type": "start-step"}); err != nil {
		return err
	}
	s.currentStepSource = sourceID
	return nil
}

func (s *aiSDKUIMessageStreamer) ensureStarted(messageID string) error {
	if s.started {
		return nil
	}
	if strings.TrimSpace(messageID) == "" {
		messageID = "assistant"
	}
	s.started = true
	if s.preserveMessageID {
		return s.writeChunk(map[string]interface{}{"type": "start"})
	}
	return s.writeChunk(map[string]interface{}{"type": "start", "messageId": messageID})
}

func (s *aiSDKUIMessageStreamer) finish(reason string) error {
	if s.finished {
		return nil
	}
	if !s.started {
		if err := s.ensureStarted("assistant"); err != nil {
			return err
		}
	}
	for id, state := range s.textParts {
		if state.started && !state.ended {
			if err := s.writeChunk(map[string]interface{}{"type": "text-end", "id": id}); err != nil {
				return err
			}
			state.ended = true
		}
	}
	for id, state := range s.reasoningParts {
		if state.started && !state.ended {
			if err := s.writeChunk(map[string]interface{}{"type": "reasoning-end", "id": id}); err != nil {
				return err
			}
			state.ended = true
		}
	}
	if !s.stepOpen {
		if err := s.writeChunk(map[string]interface{}{"type": "start-step"}); err != nil {
			return err
		}
		s.stepOpen = true
	}
	if err := s.writeChunk(map[string]interface{}{"type": "finish-step"}); err != nil {
		return err
	}
	if err := s.writeChunk(map[string]interface{}{"type": "finish", "finishReason": reason}); err != nil {
		return err
	}
	s.finished = true
	return s.writeDone()
}

func (s *aiSDKUIMessageStreamer) writeChunk(chunk map[string]interface{}) error {
	payload, err := json.Marshal(chunk)
	if err != nil {
		return err
	}
	if len(payload) > aiwire.MaxStreamChunkBytes {
		return errors.New("AI stream item exceeds frame budget; refresh history")
	}
	_, err = fmt.Fprintf(s.writer, "data: %s\n\n", payload)
	return err
}

func (s *aiSDKUIMessageStreamer) writeDone() error {
	_, err := fmt.Fprint(s.writer, "data: [DONE]\n\n")
	return err
}

func approvalIDFromPart(part map[string]interface{}) string {
	approval, ok := mapValue(part["approval"])
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue(approval["id"]))
}

func isToolPartType(value string) bool {
	return value == "dynamic-tool" || strings.HasPrefix(value, "tool-")
}

func stringValue(value interface{}) string {
	if value == nil {
		return ""
	}
	if typed, ok := value.(string); ok {
		return typed
	}
	return fmt.Sprint(value)
}

func boolValue(value interface{}) (bool, bool) {
	typed, ok := value.(bool)
	return typed, ok
}

func mapValue(value interface{}) (map[string]interface{}, bool) {
	typed, ok := value.(map[string]interface{})
	return typed, ok
}

func defaultMap(value interface{}) interface{} {
	if value == nil {
		return map[string]interface{}{}
	}
	return value
}

func coalesceString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (h *AISessionHandler) respondRuntimeError(c *gin.Context, err error) {
	var providerErr *aiprovider.ProviderError
	if errors.As(err, &providerErr) {
		RespondError(c, http.StatusBadRequest, providerErr.Code, providerErr.Message)
		return
	}

	switch {
	case errors.Is(err, aiwire.ErrHistoryQuery):
		RespondError(c, http.StatusBadRequest, "invalid_ai_history_query", err.Error())
	case errors.Is(err, aiwire.ErrHistoryCursor):
		RespondError(c, http.StatusConflict, "ai_history_cursor", err.Error())

	case errors.Is(err, aichatui.ErrSessionSearchTooLong):
		RespondError(c, http.StatusBadRequest, "ai_search_too_long", "AI 会话搜索内容最多 512 字节")
	case errors.Is(err, runtime.ErrManagerStopped):
		RespondError(c, http.StatusServiceUnavailable, "ai_runtime_stopped", "AI 服务正在关闭")
	case errors.Is(err, resultstore.ErrUnavailable):
		RespondError(c, http.StatusServiceUnavailable, "storage_unavailable", "存储暂时不可用，本轮已停止")
	case errors.Is(err, runtime.ErrSnapshotConflict):
		RespondError(c, http.StatusConflict, "ai_snapshot_conflict", "AI 会话存储版本已变化，保存未覆盖已有内容")
	case errors.Is(err, access.ErrUnauthenticated), errors.Is(err, access.ErrForbidden), errors.Is(err, access.ErrRevoked), errors.Is(err, access.ErrExpired), errors.Is(err, access.ErrResourceChanged), errors.Is(err, access.ErrCapacity):
		accessError(c, err)
	case errors.Is(err, aichatui.ErrServerReferenceUnavailable):
		RespondError(c, http.StatusBadRequest, "server_reference_unavailable", err.Error())
	case errors.Is(err, runtime.ErrSessionNotFound):
		RespondError(c, http.StatusNotFound, "session_not_found", err.Error())
	case errors.Is(err, runtime.ErrMessageNotFound):
		RespondError(c, http.StatusNotFound, "message_not_found", err.Error())
	case errors.Is(err, runtime.ErrTaskNotFound):
		RespondError(c, http.StatusNotFound, "task_not_found", err.Error())
	case errors.Is(err, runtime.ErrEmptyMessageContent), errors.Is(err, runtime.ErrInvalidDecision), errors.Is(err, runtime.ErrMessageNotEditable), errors.Is(err, runtime.ErrMessageNotDeletable):
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
	case errors.Is(err, runtime.ErrSessionBusy), errors.Is(err, runtime.ErrSessionClosed), errors.Is(err, runtime.ErrTaskConfirmationNotPending), errors.Is(err, runtime.ErrSessionHasPendingConfirmations):
		RespondError(c, http.StatusConflict, "session_conflict", err.Error())
	default:
		RespondError(c, http.StatusInternalServerError, "ai_session_error", err.Error())
	}
}
