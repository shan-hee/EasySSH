package app

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/contentstore"
)

func remoteAIIdentifier(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
func remoteAISessionPath(id string) (string, error) {
	if _, err := remoteTaskID(id); err != nil {
		return "", remoteError("invalid_ai_session_id")
	}
	return "/api/v1/ai/sessions/" + id, nil
}
func validRemoteAIPermission(value string) bool {
	return value == "" || value == "readonly" || value == "balanced" || value == "privileged"
}
func validRemoteAIStatus(value protocol.AISessionStatus) bool {
	switch value {
	case protocol.AISessionStatusIdle, protocol.AISessionStatusRunning, protocol.AISessionStatusWaitingConfirmation, protocol.AISessionStatusClosed:
		return true
	}
	return false
}
func validRemoteAIScope(scope protocol.AISessionScope) bool {
	if scope.Kind != "" && scope.Kind != "global" && scope.Kind != "terminal" || scope.Port < 0 || scope.Port > 65535 || !remoteTaskText(scope.ServerName, 1024) || !remoteText(scope.Host, 1024) || !remoteText(scope.Username, 256) {
		return false
	}
	if scope.ServerID != "" {
		if _, err := remoteTaskID(scope.ServerID); err != nil {
			return false
		}
	}
	return scope.TerminalSessionID == "" || remoteAIIdentifier(scope.TerminalSessionID)
}
func (session *desktopRemoteSession) validRemoteAIView(view *protocol.AISessionOverview, expected string) bool {
	if view == nil || !session.validTaskActor(view.Actor) || expected != "" && view.ID != expected {
		return false
	}
	if _, err := remoteTaskID(view.ID); err != nil {
		return false
	}
	if !validRemoteAIStatus(view.Status) || !validRemoteAIPermission(view.PermissionMode) || !validRemoteAIScope(view.Scope) || view.DefaultTransport != protocol.AISdkUI || view.CreatedAt.IsZero() || view.UpdatedAt.IsZero() || !remoteTaskText(view.Title, 4096) || !remoteText(view.Model, 512) {
		return false
	}
	return view.MessageCount >= 0 && view.TaskCount >= 0
}

func validRemoteAITask(task aichatui.TaskView) bool {
	if !remoteAIIdentifier(task.ID) || task.Artifact != nil || !remoteText(task.ToolName, 128) || task.CreatedAt.IsZero() || task.UpdatedAt.IsZero() {
		return false
	}
	switch task.Status {
	case aichatui.TaskStatusQueued, aichatui.TaskStatusWaitingConfirm, aichatui.TaskStatusRunning, aichatui.TaskStatusSucceeded, aichatui.TaskStatusFailed, aichatui.TaskStatusUnknown, aichatui.TaskStatusCancelled:
		return true
	}
	return false
}
func (session *desktopRemoteSession) remoteAIResponse(ctx context.Context, method, path string, input any, expected string, mutation bool) (protocol.CreateAISessionResponse, error) {
	outcome := ""
	if mutation {
		outcome = "ai_operation_outcome_unknown"
	}
	var result protocol.CreateAISessionResponse
	if err := session.requestRecord(ctx, method, path, nil, input, &result, outcome); err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	if !session.validRemoteAIView(result.Session, expected) || result.SessionID != result.Session.ID || result.DefaultTransport != result.Session.DefaultTransport {
		if mutation {
			return protocol.CreateAISessionResponse{}, remoteError(outcome)
		}
		return protocol.CreateAISessionResponse{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) RemoteAIConfig(ctx context.Context) (protocol.AIRuntimeConfig, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.AIRuntimeConfig{}, err
	}
	defer done()
	var result protocol.AIRuntimeConfig
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/ai/config", nil, nil, &result, ""); err != nil {
		return protocol.AIRuntimeConfig{}, err
	}
	if !remoteText(result.Provider, 128) || !remoteText(result.Model, 512) || len(result.Models) > 4096 {
		return protocol.AIRuntimeConfig{}, remoteError("invalid_remote_response")
	}
	for _, model := range result.Models {
		if !remoteText(model, 512) {
			return protocol.AIRuntimeConfig{}, remoteError("invalid_remote_response")
		}
	}
	return result, nil
}
func (session *desktopRemoteSession) listRemoteAISessions(ctx context.Context, input protocol.AIListInput) (protocol.ListAISessionsResponse, error) {
	if input.Page == 0 {
		input.Page = 1
	}
	if input.Limit == 0 {
		input.Limit = 20
	}
	if input.Page < 1 || input.Page > 1000000 || input.Limit < 1 || input.Limit > 100 || !remoteTaskText(input.Query, aichatui.MaxSessionSearchBytes) || !validRemoteAIScope(input.Scope) {
		return protocol.ListAISessionsResponse{}, remoteError("invalid_ai_query")
	}
	q := url.Values{"page": {strconv.Itoa(input.Page)}, "limit": {strconv.Itoa(input.Limit)}}
	for key, value := range map[string]string{"q": input.Query, "scope_kind": input.Scope.Kind, "server_id": input.Scope.ServerID, "terminal_session_id": input.Scope.TerminalSessionID} {
		if value != "" {
			q.Set(key, value)
		}
	}
	var result protocol.ListAISessionsResponse
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/ai/sessions", q, nil, &result, ""); err != nil {
		return protocol.ListAISessionsResponse{}, err
	}
	if result.Total < 0 || len(result.Items) > input.Limit || int64(len(result.Items)) > result.Total {
		return protocol.ListAISessionsResponse{}, remoteError("invalid_remote_response")
	}
	seen := map[string]bool{}
	for _, item := range result.Items {
		if _, err := remoteTaskID(item.ID); err != nil {
			return protocol.ListAISessionsResponse{}, remoteError("invalid_remote_response")
		}
		if seen[item.ID] || !session.validTaskActor(item.Actor) || !validRemoteAIStatus(item.Status) || !validRemoteAIPermission(item.PermissionMode) || !validRemoteAIScope(item.Scope) || item.MessageCount < 0 || item.TaskCount < 0 || item.CreatedAt.IsZero() || item.UpdatedAt.IsZero() {
			return protocol.ListAISessionsResponse{}, remoteError("invalid_remote_response")
		}
		seen[item.ID] = true
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) ListRemoteAISessions(ctx context.Context, input protocol.AIListInput) (protocol.ListAISessionsResponse, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.ListAISessionsResponse{}, err
	}
	defer done()
	return session.listRemoteAISessions(ctx, input)
}
func (s *DesktopRemoteWorkspaceService) GetRemoteAISession(ctx context.Context, id string) (protocol.CreateAISessionResponse, error) {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	defer done()
	return session.remoteAIResponse(ctx, http.MethodGet, path, nil, id, false)
}
func (s *DesktopRemoteWorkspaceService) LatestRemoteAISession(ctx context.Context) (protocol.CreateAISessionResponse, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	defer done()
	return session.remoteAIResponse(ctx, http.MethodGet, "/api/v1/ai/sessions/latest", nil, "", false)
}
func (s *DesktopRemoteWorkspaceService) CreateRemoteAISession(ctx context.Context, input protocol.CreateAISessionRequest) (protocol.CreateAISessionResponse, error) {
	if !remoteText(input.Model, 512) || !validRemoteAIPermission(input.PermissionMode) || !validRemoteAIScope(input.Scope) {
		return protocol.CreateAISessionResponse{}, remoteError("invalid_ai_session")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	defer done()
	return session.remoteAIResponse(ctx, http.MethodPost, "/api/v1/ai/sessions", input, "", true)
}
func (s *DesktopRemoteWorkspaceService) RenameRemoteAISession(ctx context.Context, id, title string) error {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return err
	}
	if strings.TrimSpace(title) == "" || !remoteTaskText(title, 4096) {
		return remoteError("invalid_ai_title")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	var result protocol.AIUpdated
	if err := session.requestRecord(ctx, http.MethodPatch, path, nil, protocol.RenameAISessionRequest{Title: title}, &result, "ai_operation_outcome_unknown"); err != nil {
		return err
	}
	if !result.Updated {
		return remoteError("ai_operation_outcome_unknown")
	}
	return nil
}
func (s *DesktopRemoteWorkspaceService) CancelRemoteAISession(ctx context.Context, id string) error {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return err
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	var result protocol.AICancelled
	if err := session.requestRecord(ctx, http.MethodPost, path+"/cancel", nil, nil, &result, "ai_operation_outcome_unknown"); err != nil {
		return err
	}
	if !result.Cancelled {
		return remoteError("ai_operation_outcome_unknown")
	}
	return nil
}
func (s *DesktopRemoteWorkspaceService) DeleteRemoteAISession(ctx context.Context, id string) error {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return err
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	return session.requestRecord(ctx, http.MethodDelete, path, nil, nil, nil, "ai_operation_outcome_unknown")
}
func (s *DesktopRemoteWorkspaceService) UpdateRemoteAIMessage(ctx context.Context, id, messageID string, input protocol.UpdateAIMessageRequest) (protocol.CreateAISessionResponse, error) {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	if !remoteAIIdentifier(messageID) || strings.TrimSpace(input.Content) == "" || !remoteTaskText(input.Content, 1<<20) || len(input.ServerReferences) > 100 {
		return protocol.CreateAISessionResponse{}, remoteError("invalid_ai_message")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	defer done()
	return session.remoteAIResponse(ctx, http.MethodPatch, path+"/messages/"+messageID, input, id, true)
}
func (s *DesktopRemoteWorkspaceService) DeleteRemoteAIMessage(ctx context.Context, id, messageID string) (protocol.CreateAISessionResponse, error) {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	if !remoteAIIdentifier(messageID) {
		return protocol.CreateAISessionResponse{}, remoteError("invalid_ai_message")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.CreateAISessionResponse{}, err
	}
	defer done()
	return session.remoteAIResponse(ctx, http.MethodDelete, path+"/messages/"+messageID, nil, id, true)
}
func (s *DesktopRemoteWorkspaceService) GetRemoteAITaskFile(ctx context.Context, id, taskID string) (protocol.ContentReference, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	defer done()
	return session.remoteAITaskFile(ctx, id, taskID)
}

func (session *desktopRemoteSession) remoteAITaskFile(ctx context.Context, id, taskID string) (protocol.ContentReference, error) {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	if !remoteAIIdentifier(taskID) {
		return protocol.ContentReference{}, remoteError("invalid_ai_task_id")
	}
	var result protocol.ContentReference
	if err := session.requestRecord(ctx, http.MethodGet, path+"/tasks/"+taskID+"/file", nil, nil, &result, ""); err != nil {
		return protocol.ContentReference{}, err
	}
	if contentstore.ValidateReference(result) != nil || result.MediaType != "application/json" || result.Size < 1 {
		return protocol.ContentReference{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
