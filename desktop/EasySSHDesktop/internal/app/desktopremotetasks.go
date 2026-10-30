package app

import (
	"context"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
)

func remoteTaskQuery(input protocol.TaskListInput) (url.Values, protocol.TaskListInput, error) {
	if input.Page == 0 {
		input.Page = 1
	}
	if input.PageSize == 0 {
		input.PageSize = 20
	}
	if input.Page < 1 || input.Page > 1000000 || input.PageSize < 1 || input.PageSize > 100 || !remoteText(input.Keyword, 512) || len(input.Statuses) > 9 || len(input.TaskTypes) > 32 || len(input.TriggerTypes) > 4 {
		return nil, input, remoteError("invalid_task_query")
	}
	q := url.Values{"page": {strconv.Itoa(input.Page)}, "page_size": {strconv.Itoa(input.PageSize)}}
	statuses := make([]string, 0, len(input.Statuses))
	for _, status := range input.Statuses {
		if !status.Valid() {
			return nil, input, remoteError("invalid_task_query")
		}
		statuses = append(statuses, string(status))
	}
	triggers := make([]string, 0, len(input.TriggerTypes))
	for _, trigger := range input.TriggerTypes {
		if !trigger.Valid() {
			return nil, input, remoteError("invalid_task_query")
		}
		triggers = append(triggers, string(trigger))
	}
	for _, kind := range input.TaskTypes {
		if kind == "" || !remoteText(kind, 50) || strings.ContainsAny(kind, ", \t\r\n") {
			return nil, input, remoteError("invalid_task_query")
		}
	}
	if len(statuses) > 0 {
		q.Set("status", strings.Join(statuses, ","))
	}
	if len(triggers) > 0 {
		q.Set("trigger_type", strings.Join(triggers, ","))
	}
	if len(input.TaskTypes) > 0 {
		q.Set("task_type", strings.Join(input.TaskTypes, ","))
	}
	if input.Keyword != "" {
		q.Set("keyword", input.Keyword)
	}
	return q, input, nil
}

func remoteTaskID(id string) (uuid.UUID, error) {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed == uuid.Nil || parsed.String() != id {
		return uuid.Nil, remoteError("invalid_task_id")
	}
	return parsed, nil
}
func (session *desktopRemoteSession) validTaskActor(actor protocol.Actor) bool {
	return actor.Valid() && actor.Kind == protocol.Visitor && actor.ID == session.client.sessionID && actor.SessionID == session.client.sessionID && actor.GrantID == session.client.grantID
}
func (session *desktopRemoteSession) validTaskSummary(r *protocol.TaskOverview) bool {
	if r == nil || r.ID == uuid.Nil || r.WorkID == uuid.Nil || !session.validTaskActor(r.Actor) || !r.Status.Valid() || !r.TriggerType.Valid() || r.Runner != "server" {
		return false
	}
	if r.Attempt < 1 || r.MaxAttempts < 1 || r.Progress < 0 || r.Progress > 100 || r.TotalCount < 0 || r.SuccessCount < 0 || r.FailureCount < 0 || r.BytesTotal < 0 || r.BytesProcessed < 0 || r.CreatedAt.IsZero() || r.UpdatedAt.IsZero() || r.WorkStartedAt.IsZero() {
		return false
	}
	if r.ParentWorkID != nil && (*r.ParentWorkID == uuid.Nil || *r.ParentWorkID == r.WorkID) || r.ServerID != nil && *r.ServerID == uuid.Nil {
		return false
	}
	return remoteText(r.TaskType, 50) && r.TaskType != "" && utf8.ValidString(r.Title) && utf8.ValidString(r.Stage) && utf8.ValidString(r.ServerName) && utf8.ValidString(r.Resource) && utf8.ValidString(r.ErrorMessage) && remoteText(r.SourceType, 80) && remoteText(r.SourceID, 256)
}

func (session *desktopRemoteSession) listRemoteTasks(ctx context.Context, input protocol.TaskListInput) (protocol.TaskRunList, error) {
	q, input, err := remoteTaskQuery(input)
	if err != nil {
		return protocol.TaskRunList{}, err
	}
	var result protocol.TaskRunList
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/tasks", q, nil, &result, ""); err != nil {
		return protocol.TaskRunList{}, err
	}
	if result.Page != input.Page || result.PageSize != input.PageSize || result.Total < 0 || len(result.Runs) > input.PageSize || int64(len(result.Runs)) > result.Total || int64(result.TotalPages) != remoteTaskPages(result.Total, result.PageSize) {
		return protocol.TaskRunList{}, remoteError("invalid_remote_response")
	}
	seen := map[uuid.UUID]bool{}
	for _, run := range result.Runs {
		if run == nil || !session.validTaskSummary(run) || !taskprotocol.ValidOverviewText(*run) || seen[run.ID] {
			return protocol.TaskRunList{}, remoteError("invalid_remote_response")
		}
		seen[run.ID] = true
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) ListRemoteTasks(ctx context.Context, input protocol.TaskListInput) (protocol.TaskRunList, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TaskRunList{}, err
	}
	defer done()
	return session.listRemoteTasks(ctx, input)
}

func (session *desktopRemoteSession) getRemoteTask(ctx context.Context, id string) (protocol.TaskRunDetails, error) {
	parsed, err := remoteTaskID(id)
	if err != nil {
		return protocol.TaskRunDetails{}, err
	}
	var result protocol.TaskRunDetails
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/tasks/"+id, nil, nil, &result, ""); err != nil {
		return protocol.TaskRunDetails{}, err
	}
	r := result.Run
	if r == nil || r.ID != parsed {
		return protocol.TaskRunDetails{}, remoteError("invalid_remote_response")
	}
	if !session.validTaskSummary(r) || len(r.TruncatedFields) != 0 || taskprotocol.ValidateContent(result.Content) != nil {
		return protocol.TaskRunDetails{}, remoteError("invalid_remote_response")
	}
	if len(result.Content.Data) > 0 {
		var body protocol.TaskBody
		if json.Unmarshal(result.Content.Data, &body) != nil || body.TaskRunID != parsed {
			return protocol.TaskRunDetails{}, remoteError("invalid_remote_response")
		}
	}

	return result, nil
}
func (s *DesktopRemoteWorkspaceService) GetRemoteTask(ctx context.Context, id string) (protocol.TaskRunDetails, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TaskRunDetails{}, err
	}
	defer done()
	return session.getRemoteTask(ctx, id)
}

func (s *DesktopRemoteWorkspaceService) RemoteTaskStatistics(ctx context.Context) (protocol.TaskStatistics, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TaskStatistics{}, err
	}
	defer done()
	var r protocol.TaskStatistics
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/tasks/statistics", nil, nil, &r, ""); err != nil {
		return protocol.TaskStatistics{}, err
	}
	// Statistics already come from the source actor-filtered query; no local
	// execution record is created when reading or canceling remote tasks.
	sum := int64(0)
	for _, n := range []int64{r.Queued, r.Running, r.Canceling, r.Succeeded, r.Failed, r.PartialSuccess, r.Canceled, r.Timeout, r.Unknown} {
		if n < 0 || n > r.Total || sum > r.Total-n {
			return protocol.TaskStatistics{}, remoteError("invalid_remote_response")
		}
		sum += n
	}
	if r.Total < 0 || sum != r.Total {
		return protocol.TaskStatistics{}, remoteError("invalid_remote_response")
	}
	return r, nil
}
func (session *desktopRemoteSession) cancelRemoteTask(ctx context.Context, id string) (protocol.TaskCancellation, error) {
	detail, err := session.getRemoteTask(ctx, id)
	if err != nil {
		return protocol.TaskCancellation{}, err
	}
	if !detail.Run.Cancelable || detail.Run.Status != protocol.TaskStatusQueued && detail.Run.Status != protocol.TaskStatusRunning {
		return protocol.TaskCancellation{}, remoteError("task_not_cancelable")
	}
	var result protocol.TaskCancellation
	if err := session.requestRecord(ctx, http.MethodPost, "/api/v1/tasks/"+id+"/cancel", nil, nil, &result, "task_cancel_outcome_unknown"); err != nil {
		return protocol.TaskCancellation{}, err
	}
	if result.ID != detail.Run.ID || !result.Status.Valid() {
		return protocol.TaskCancellation{}, remoteError("task_cancel_outcome_unknown")
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) CancelRemoteTask(ctx context.Context, id string) (protocol.TaskCancellation, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TaskCancellation{}, err
	}
	defer done()
	return session.cancelRemoteTask(ctx, id)
}

func remoteTaskText(value string, limit int) bool {
	return len(value) <= limit && utf8.ValidString(value) && !strings.ContainsRune(value, 0)
}
func remoteTaskPages(total int64, size int) int64 {
	pages := total / int64(size)
	if total%int64(size) != 0 {
		pages++
	}
	return pages
}

func (session *desktopRemoteSession) listRemoteTaskEvents(ctx context.Context, id string, input protocol.TaskEventInput) (protocol.TaskEventPage, error) {
	parsed, err := remoteTaskID(id)
	if err != nil {
		return protocol.TaskEventPage{}, err
	}
	input, err = taskprotocol.NormalizeEventInput(input)
	if err != nil {
		return protocol.TaskEventPage{}, remoteError("invalid_task_event_query")
	}
	query := url.Values{"after_id": {strconv.FormatUint(uint64(input.AfterID), 10)}, "limit": {strconv.Itoa(input.Limit)}}
	var result protocol.TaskEventPage
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/tasks/"+id+"/events", query, nil, &result, ""); err != nil {
		return protocol.TaskEventPage{}, err
	}
	if err := taskprotocol.ValidateEventPage(parsed.String(), input, result); err != nil {
		return protocol.TaskEventPage{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) ListRemoteTaskEvents(ctx context.Context, id string, input protocol.TaskEventInput) (protocol.TaskEventPage, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TaskEventPage{}, err
	}
	defer done()
	return session.listRemoteTaskEvents(ctx, id, input)
}
