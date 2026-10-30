package taskcenter

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Task state and its activity projection commit together. Transfers have their
// own durable facts and projection, so their TaskRun is never counted again.
func projectRun(tx *gorm.DB, run *TaskRun) error {
	if err := enqueueCompletion(tx, run); err != nil {
		return err
	}
	if run.SourceType == "batch_task" {
		state := "failed"
		switch run.Status {
		case StatusQueued:
			state = "queued"
		case StatusRunning, StatusCanceling:
			state = "running"
		case StatusSucceeded, StatusPartialSuccess:
			state = "completed"
		case StatusCanceled:
			state = "cancelled"
		case StatusUnknown:
			state = "unknown"
		}
		duration := 0
		if run.StartedAt != nil && run.FinishedAt != nil {
			duration = int(run.FinishedAt.Sub(*run.StartedAt).Seconds())
		}
		if err := tx.Table("batch_tasks").Where("id = ?", run.SourceID).Updates(map[string]interface{}{"status": state, "updated_at": run.UpdatedAt, "started_at": run.StartedAt, "completed_at": run.FinishedAt, "duration": duration, "success_count": run.SuccessCount, "failed_count": run.FailureCount}).Error; err != nil {
			return err
		}
	}
	if run.SourceType == "transfer_job" {
		return nil
	}
	transfer := run.TaskType == "sftp_upload" || run.TaskType == "sftp_download"
	if transfer {
		var count int64
		if err := tx.Model(&operationrecord.OperationRecord{}).Where("source_table = ? AND work_id = ? AND attempt = ?", "transfer_jobs", run.WorkID, run.Attempt).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
	}
	status := activityStatus(run.Status)
	source := "manual"
	if run.TriggerType == TriggerScheduled || run.TriggerType == TriggerSystem {
		source = "automation"
	}
	if run.Actor.GrantID != "" {
		source = "share"
	}
	record := &operationrecord.OperationRecord{
		Actor: run.Actor, WorkID: run.WorkID, ParentWorkID: run.ParentWorkID, WorkStartedAt: run.WorkStartedAt, Attempt: run.Attempt,
		Type: operationrecord.TypeExecution, Category: operationrecord.CategoryActivity, Action: run.TaskType, Status: status,
		ServerID: run.ServerID, ServerName: run.ServerName, Title: run.Title, Resource: run.Resource, Source: source,
		StartedAt: run.StartedAt, FinishedAt: run.FinishedAt, Progress: run.Progress, TotalCount: run.TotalCount,
		SuccessCount: run.SuccessCount, FailureCount: run.FailureCount, BytesTotal: run.BytesTotal, BytesProcessed: run.BytesProcessed,
		ErrorMessage: run.ErrorMessage, DetailJSON: run.ResultJSON, SourceTable: "task_runs", SourceID: run.ID.String(), CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt,
	}
	if run.ContentID != nil {
		// Retain the same immutable body for the activity's own lifetime. The
		// result is never copied back into the activity table or another file.
		record.DetailJSON = ""
		record.TaskContentID, record.TaskContentSize, record.TaskContentSHA256 = run.ContentID, run.ContentSize, run.ContentSHA256
	}

	if transfer {
		record.Type = operationrecord.TypeTransfer
	}
	if run.StartedAt != nil && run.FinishedAt != nil {
		record.DurationMs = run.FinishedAt.Sub(*run.StartedAt).Milliseconds()
	}
	// Execution results are the per-target facts owned by the executor. JSON is
	// decoded at write time; activity filters never need to query JSON columns.
	type targetFact struct {
		ServerID     uuid.UUID
		ServerName   string
		Status       string
		StartTime    time.Time
		EndTime      *time.Time
		Duration     int64
		ErrorMessage string
	}
	var targets []targetFact
	if strings.HasPrefix(strings.TrimSpace(run.ResultJSON), "[") {
		_ = json.Unmarshal([]byte(run.ResultJSON), &targets)
	}
	known := map[uuid.UUID]bool{}
	for _, target := range targets {
		known[target.ServerID] = true
	}
	resourceIDs := run.Resource
	if run.SourceType == "docker" {
		resourceIDs = ""
	}
	for _, value := range strings.Split(resourceIDs, ",") {
		id, err := uuid.Parse(strings.TrimSpace(value))
		if err != nil || known[id] {
			continue
		}
		known[id] = true
		var snapshot struct{ Name string }
		if err := tx.Table("servers").Select("name").Where("id = ?", id).Scan(&snapshot).Error; err != nil {
			return err
		}
		targetStatus := status
		if status == operationrecord.StatusSuccess || status == operationrecord.StatusPartial {
			targetStatus = operationrecord.StatusWarning
		}
		targets = append(targets, targetFact{ServerID: id, ServerName: snapshot.Name, Status: string(targetStatus), StartTime: run.CreatedAt, EndTime: run.FinishedAt})
	}
	for _, target := range targets {
		if target.ServerID != uuid.Nil {
			record.Resources = append(record.Resources, operationrecord.ResourceSnapshot{ServerID: target.ServerID, Name: target.ServerName})
		}
	}
	repo := operationrecord.NewRepository(tx, nil)
	if err := repo.Upsert(tx.Statement.Context, record); err != nil {
		return err
	}
	// Before a durable TransferJob exists, this is the preparation attempt.
	// The transfer transaction replaces it while retaining the same WorkID.
	if transfer {
		return nil
	}
	for _, target := range targets {
		if target.ServerID == uuid.Nil {
			continue
		}
		targetStatus := operationrecord.Status(target.Status)
		if target.Status == "failed" {
			targetStatus = operationrecord.StatusFailure
		}
		if target.Status == "canceled" {
			targetStatus = operationrecord.StatusCanceled
		}
		started := target.StartTime
		if started.IsZero() {
			started = run.CreatedAt
		}
		child := &operationrecord.OperationRecord{
			Actor: run.Actor, WorkID: uuid.NewSHA1(run.WorkID, []byte(target.ServerID.String())), ParentWorkID: &run.WorkID, WorkStartedAt: run.WorkStartedAt, Attempt: run.Attempt,
			Type: operationrecord.TypeExecution, Category: operationrecord.CategoryActivity, Action: run.TaskType, Status: targetStatus,
			ServerID: &target.ServerID, ServerName: target.ServerName, Title: run.Title, Source: source, Resource: run.Resource,
			StartedAt: &started, FinishedAt: target.EndTime, DurationMs: target.Duration, ErrorMessage: target.ErrorMessage,
			SourceTable: "task_target_runs", SourceID: run.ID.String() + ":" + target.ServerID.String(), CreatedAt: started, UpdatedAt: run.UpdatedAt,
		}
		if err := repo.Upsert(tx.Statement.Context, child); err != nil {
			return err
		}
	}
	return nil
}
func activityStatus(status Status) operationrecord.Status {
	switch status {
	case StatusQueued:
		return operationrecord.StatusPending
	case StatusRunning, StatusCanceling:
		return operationrecord.StatusRunning
	case StatusSucceeded:
		return operationrecord.StatusSuccess
	case StatusFailed:
		return operationrecord.StatusFailure
	case StatusPartialSuccess:
		return operationrecord.StatusPartial
	case StatusCanceled:
		return operationrecord.StatusCanceled
	case StatusTimeout:
		return operationrecord.StatusTimeout
	case StatusUnknown:
		return operationrecord.StatusUnknown
	default:
		return operationrecord.StatusWarning
	}
}
