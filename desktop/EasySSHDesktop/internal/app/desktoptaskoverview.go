package app

import (
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/taskprotocol"
)

type DesktopTaskOverview struct {
	WorkID            string         `json:"work_id"`
	ParentWorkID      string         `json:"parent_work_id,omitempty"`
	WorkStartedAt     string         `json:"work_started_at"`
	ID                string         `json:"id"`
	Actor             protocol.Actor `json:"actor"`
	DefinitionID      string         `json:"definition_id,omitempty"`
	RetryOfID         string         `json:"retry_of_id,omitempty"`
	SourceType        string         `json:"source_type,omitempty"`
	SourceID          string         `json:"source_id,omitempty"`
	TaskType          string         `json:"task_type"`
	Title             string         `json:"title"`
	TriggerType       string         `json:"trigger_type"`
	Runner            string         `json:"runner"`
	Status            string         `json:"status"`
	Stage             string         `json:"stage,omitempty"`
	ServerID          string         `json:"server_id,omitempty"`
	ServerName        string         `json:"server_name,omitempty"`
	Resource          string         `json:"resource,omitempty"`
	Progress          int            `json:"progress"`
	TotalCount        int            `json:"total_count"`
	SuccessCount      int            `json:"success_count"`
	FailureCount      int            `json:"failure_count"`
	BytesTotal        int64          `json:"bytes_total"`
	BytesCompleted    int64          `json:"bytes_completed"`
	BytesProcessed    int64          `json:"bytes_processed"`
	Cancelable        bool           `json:"cancelable"`
	Retryable         bool           `json:"retryable"`
	Attempt           int            `json:"attempt"`
	MaxAttempts       int            `json:"max_attempts"`
	ErrorCode         string         `json:"error_code,omitempty"`
	ErrorMessage      string         `json:"error_message,omitempty"`
	CancelRequestedAt string         `json:"cancel_requested_at,omitempty"`
	StartedAt         string         `json:"started_at,omitempty"`
	FinishedAt        string         `json:"finished_at,omitempty"`
	CreatedAt         string         `json:"created_at"`
	UpdatedAt         string         `json:"updated_at"`
	TruncatedFields   []string       `json:"truncated_fields,omitempty"`
}

func desktopTaskFullOverview(run DesktopTaskRun) DesktopTaskOverview {
	view := DesktopTaskOverview{WorkID: run.WorkID, ParentWorkID: run.ParentWorkID, WorkStartedAt: run.WorkStartedAt, ID: run.ID, Actor: run.Actor, DefinitionID: run.DefinitionID, RetryOfID: run.RetryOfID, SourceType: run.SourceType, SourceID: run.SourceID, TaskType: run.TaskType, Title: run.Title, TriggerType: run.TriggerType, Runner: run.Runner, Status: run.Status, Stage: run.Stage, ServerID: run.ServerID, ServerName: run.ServerName, Resource: run.Resource, Progress: run.Progress, TotalCount: run.TotalCount, SuccessCount: run.SuccessCount, FailureCount: run.FailureCount, BytesTotal: run.BytesTotal, BytesCompleted: run.BytesCompleted, BytesProcessed: run.BytesProcessed, Cancelable: run.Cancelable, Retryable: run.Retryable, Attempt: run.Attempt, MaxAttempts: run.MaxAttempts, ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage, CancelRequestedAt: run.CancelRequestedAt, StartedAt: run.StartedAt, FinishedAt: run.FinishedAt, CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt}
	return view
}

func desktopTaskOverview(run DesktopTaskRun) DesktopTaskOverview {
	view := desktopTaskFullOverview(run)
	for _, field := range []struct {
		name  string
		value *string
	}{{"title", &view.Title}, {"stage", &view.Stage}, {"server_name", &view.ServerName}, {"resource", &view.Resource}, {"error_message", &view.ErrorMessage}} {
		text, changed := taskprotocol.PreviewText(*field.value)
		*field.value = text
		if changed {
			view.TruncatedFields = append(view.TruncatedFields, field.name)
		}
	}
	return view
}
func (s *DesktopTaskService) getOverview(id string) (DesktopTaskOverview, error) {
	db, err := s.database()
	if err != nil {
		return DesktopTaskOverview{}, err
	}
	run, err := scanDesktopTaskRun(db.QueryRow(desktopTaskSummarySQL+" WHERE id=?", id))
	if err != nil {
		return DesktopTaskOverview{}, err
	}
	return desktopTaskOverview(run), nil
}

const desktopTaskSummarySQL = `SELECT id, work_id, parent_work_id, work_started_at, actor_kind, actor_id, actor_session_id, actor_grant_id, definition_id, retry_of_id, source_type, source_id, task_type, substr(title,1,513) AS title,
	'' AS description, trigger_type, runner, status, substr(stage,1,513) AS stage, server_id, substr(server_name,1,513) AS server_name, substr(resource,1,513) AS resource, '' AS payload_json, '' AS result_json,
	progress, total_count, success_count, failure_count, bytes_total, bytes_processed, bytes_completed, '' AS progress_json, cancelable,
	retryable, attempt, max_attempts, error_code, substr(error_message,1,513) AS error_message, cancel_requested_at, started_at, finished_at,
	created_at, updated_at FROM desktop_task_runs`
