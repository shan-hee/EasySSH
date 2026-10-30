package app

import (
	"context"
	"encoding/json"
	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/url"
	"strconv"
)

func (s *DesktopRemoteWorkspaceService) RemoteAIHistory(ctx context.Context, id string, input protocol.AIHistoryInput) (protocol.AIHistoryPage, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	defer done()
	return session.remoteAIHistory(ctx, id, input)
}
func (session *desktopRemoteSession) remoteAIHistory(ctx context.Context, id string, input protocol.AIHistoryInput) (protocol.AIHistoryPage, error) {
	path, err := remoteAISessionPath(id)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	input, err = aiwire.NormalizeHistoryInput(input)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	query := url.Values{"kind": {input.Kind}, "after_id": {input.AfterID}, "limit": {strconv.Itoa(input.Limit)}}
	var page protocol.AIHistoryPage
	if err := session.requestRecord(ctx, http.MethodGet, path+"/history", query, nil, &page, ""); err != nil {
		return page, err
	}
	if err := aiwire.ValidateHistoryPage(id, input, page); err != nil {
		return protocol.AIHistoryPage{}, remoteError("invalid_remote_response")
	}
	for _, item := range page.Items {
		if len(item.Data) == 0 {
			continue
		}
		if input.Kind == "tasks" {
			var task aichatui.TaskView
			if json.Unmarshal(item.Data, &task) != nil || task.ID != item.ID || !validRemoteAITask(task) {
				return protocol.AIHistoryPage{}, remoteError("invalid_remote_response")
			}
		} else {
			var message aichatui.MessageView
			if json.Unmarshal(item.Data, &message) != nil || message.ID != item.ID || message.CreatedAt.IsZero() || (message.Role != "user" && message.Role != "assistant" && message.Role != "system") {
				return protocol.AIHistoryPage{}, remoteError("invalid_remote_response")
			}
		}
	}
	return page, nil
}
