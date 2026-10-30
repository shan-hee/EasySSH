package app

import (
	"context"
	"database/sql"
	"errors"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/google/uuid"
)

const desktopActivitySelectSQL = `SELECT id,action,resource,status,COALESCE(server_id,''),COALESCE(duration_ms,0),COALESCE(detail,''),created_at,
 actor_kind,actor_id,actor_session_id,actor_grant_id,work_id,parent_work_id,work_started_at,attempt,source_table,source_id,server_name,started_at,finished_at,
 total_count,success_count,failure_count,bytes_total,bytes_processed,bytes_completed,kind,source,established_at,connection_uncertain_until,task_content_id,task_content_size,task_content_sha256,error_message,detail_content_id,detail_content_size,detail_content_sha256 FROM activity_logs`

// Lists and aggregate inputs exclude bodies; detail reads use the full select.
const desktopActivitySummarySQL = `SELECT id,action,resource,status,COALESCE(server_id,''),COALESCE(duration_ms,0),'' AS detail,created_at,
 actor_kind,actor_id,actor_session_id,actor_grant_id,work_id,parent_work_id,work_started_at,attempt,source_table,source_id,server_name,started_at,finished_at,
 total_count,success_count,failure_count,bytes_total,bytes_processed,bytes_completed,kind,source,established_at,connection_uncertain_until,
 NULL AS task_content_id,0 AS task_content_size,'' AS task_content_sha256,error_message,NULL AS detail_content_id,0 AS detail_content_size,'' AS detail_content_sha256 FROM activity_logs`

func scanDesktopActivity(row interface{ Scan(...any) error }) (DesktopActivityLogItem, error) {
	var item DesktopActivityLogItem
	var contentID, detailID sql.NullString
	var detailRef protocol.ContentReference
	var ref protocol.ContentReference
	err := row.Scan(&item.ID, &item.Action, &item.Resource, &item.Status, &item.ServerID, &item.DurationMs, &item.Detail, &item.CreatedAt,
		&item.Actor.Kind, &item.Actor.ID, &item.Actor.SessionID, &item.Actor.GrantID, &item.WorkID, &item.ParentWorkID, &item.WorkStartedAt, &item.Attempt, &item.SourceTable, &item.SourceID, &item.ServerName, &item.StartedAt, &item.FinishedAt,
		&item.TotalCount, &item.SuccessCount, &item.FailureCount, &item.BytesTotal, &item.BytesProcessed, &item.BytesCompleted, &item.Kind, &item.Source, &item.EstablishedAt, &item.ConnectionUncertainUntil, &contentID, &ref.Size, &ref.Sha256, &item.ErrorMessage, &detailID, &detailRef.Size, &detailRef.Sha256)
	if err != nil {
		return item, err
	}
	if contentID.Valid {
		parsed, err := uuid.Parse(contentID.String)
		if err != nil {
			return item, err
		}
		ref.ID, ref.MediaType = parsed, "application/json"
		if err := contentstore.ValidateReference(ref); err != nil {
			return item, err
		}
		item.TaskContent = &ref
	}
	if detailID.Valid {
		parsed, err := uuid.Parse(detailID.String)
		if err != nil {
			return item, err
		}
		detailRef.ID, detailRef.MediaType = parsed, "text/plain; charset=utf-8"
		if err := contentstore.ValidateReference(detailRef); err != nil {
			return item, err
		}
		item.DetailContent = &detailRef
	}
	return item, nil
}

func upsertDesktopActivity(tx *sql.Tx, item DesktopActivityLogItem) error {
	if item.Kind == "" {
		item.Kind = desktopActivityKind(item.Action)
	}
	if item.Source == "" {
		item.Source = "manual"
	}
	if item.ServerID != "" && item.ServerName == "" {
		err := tx.QueryRow(`SELECT name FROM desktop_servers WHERE id=?`, item.ServerID).Scan(&item.ServerName)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
	}

	var contentID any
	var contentSize int64
	var contentHash string
	if item.TaskContent != nil {
		contentID, contentSize, contentHash = item.TaskContent.ID.String(), item.TaskContent.Size, item.TaskContent.Sha256
		item.Detail = ""
	}

	var detailID any
	var detailSize int64
	var detailHash string
	if item.DetailContent != nil {
		if item.TaskContent != nil || contentstore.ValidateReference(*item.DetailContent) != nil || item.DetailContent.MediaType != "text/plain; charset=utf-8" {
			return errors.New("invalid activity detail reference")
		}
		detailID, detailSize, detailHash = item.DetailContent.ID.String(), item.DetailContent.Size, item.DetailContent.Sha256
		item.Detail = ""
	}
	_, err := tx.Exec(`INSERT INTO activity_logs(id,action,resource,status,server_id,duration_ms,detail,created_at,updated_at,
 actor_kind,actor_id,actor_session_id,actor_grant_id,work_id,parent_work_id,work_started_at,attempt,source_table,source_id,server_name,started_at,finished_at,
 total_count,success_count,failure_count,bytes_total,bytes_processed,bytes_completed,kind,source,established_at,connection_uncertain_until,task_content_id,task_content_size,task_content_sha256,error_message,detail_content_id,detail_content_size,detail_content_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(source_table,source_id) DO UPDATE SET action=excluded.action,resource=excluded.resource,status=excluded.status,server_id=excluded.server_id,
 duration_ms=excluded.duration_ms,detail=CASE WHEN excluded.task_content_id IS NOT NULL OR excluded.detail_content_id IS NOT NULL THEN '' WHEN excluded.source_table='desktop_task_runs' THEN excluded.detail ELSE COALESCE(NULLIF(excluded.detail,''),activity_logs.detail) END,updated_at=excluded.updated_at,
 work_id=excluded.work_id,parent_work_id=excluded.parent_work_id,work_started_at=excluded.work_started_at,attempt=excluded.attempt,server_name=CASE WHEN activity_logs.server_name='' THEN excluded.server_name ELSE activity_logs.server_name END,
 kind=excluded.kind,source=excluded.source,established_at=excluded.established_at,connection_uncertain_until=excluded.connection_uncertain_until,
 started_at=excluded.started_at,finished_at=excluded.finished_at,total_count=excluded.total_count,success_count=excluded.success_count,failure_count=excluded.failure_count,
 bytes_total=excluded.bytes_total,bytes_processed=excluded.bytes_processed,bytes_completed=excluded.bytes_completed,task_content_id=excluded.task_content_id,task_content_size=excluded.task_content_size,task_content_sha256=excluded.task_content_sha256,error_message=excluded.error_message,detail_content_id=excluded.detail_content_id,detail_content_size=excluded.detail_content_size,detail_content_sha256=excluded.detail_content_sha256`,
		item.ID, item.Action, item.Resource, item.Status, item.ServerID, item.DurationMs, item.Detail, item.CreatedAt, desktopTaskNow(),
		item.Actor.Kind, item.Actor.ID, item.Actor.SessionID, item.Actor.GrantID, item.WorkID, item.ParentWorkID, item.WorkStartedAt, item.Attempt, item.SourceTable, item.SourceID, item.ServerName, item.StartedAt, item.FinishedAt,
		item.TotalCount, item.SuccessCount, item.FailureCount, item.BytesTotal, item.BytesProcessed, item.BytesCompleted, item.Kind, item.Source, item.EstablishedAt, item.ConnectionUncertainUntil, contentID, contentSize, contentHash, item.ErrorMessage, detailID, detailSize, detailHash)
	if err != nil {
		return err
	}
	if item.ServerID != "" {
		item.Resources = append(item.Resources, activitystats.Resource{ServerID: item.ServerID, Name: item.ServerName})
	}
	return addDesktopActivityResources(tx, item.SourceTable, item.SourceID, item.Resources)
}

// This projection shares the task transaction, never another service's DB
// handle. Repeated progress replaces the same source row instead of counting
// another activity. Remote transport receipts never enter this function.
func projectDesktopTask(tx *sql.Tx, id string) error {
	run, err := scanDesktopTaskRun(tx.QueryRow(desktopTaskSelectSQL+" WHERE id=?", id))
	if err != nil {
		return err
	}
	status := DesktopActivityLogStatus("failure")
	switch run.Status {
	case "queued":
		status = "pending"
	case "running", "canceling":
		status = "running"
	case "succeeded":
		status = "success"
	case "partial_success":
		status = "partial"
	case "canceled":
		status = "canceled"
	case "timeout":
		status = "timeout"
	case "unknown":
		status = "unknown"
	}
	item := DesktopActivityLogItem{ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte("desktop_task_runs:"+run.ID)).String(),
		Actor: run.Actor, WorkID: run.WorkID, ParentWorkID: run.ParentWorkID, WorkStartedAt: run.WorkStartedAt, Attempt: run.Attempt,
		SourceTable: "desktop_task_runs", SourceID: run.ID, Action: run.TaskType, Resource: run.Resource, Status: status, ServerID: run.ServerID, ServerName: run.ServerName, ErrorMessage: run.ErrorMessage,
		StartedAt: run.StartedAt, FinishedAt: run.FinishedAt, CreatedAt: run.CreatedAt, TotalCount: run.TotalCount, SuccessCount: run.SuccessCount, FailureCount: run.FailureCount,
		BytesTotal: run.BytesTotal, BytesProcessed: run.BytesProcessed, BytesCompleted: run.BytesCompleted}
	ref, err := desktopTaskContentReference(context.Background(), tx, run.ID)
	if err != nil {
		return err
	}
	item.TaskContent = ref
	if ref == nil {
		item.Detail = run.ResultJSON
	}

	started, startErr := time.Parse(time.RFC3339Nano, run.StartedAt)
	finished, endErr := time.Parse(time.RFC3339Nano, run.FinishedAt)
	if startErr == nil && endErr == nil && !finished.Before(started) {
		item.DurationMs = finished.Sub(started).Milliseconds()
	}
	if run.SourceType == "desktop_batch_task" {
		batchStatus := "failed"
		switch run.Status {
		case "queued":
			batchStatus = "queued"
		case "running", "canceling":
			batchStatus = "running"
		case "succeeded", "partial_success":
			batchStatus = "completed"
		case "canceled":
			batchStatus = "cancelled"
		case "unknown":
			batchStatus = "unknown"
		}
		result, err := tx.Exec(`UPDATE desktop_batch_tasks SET status=?,success_count=?,failed_count=?,started_at=?,completed_at=?,duration=?,updated_at=? WHERE id=?`, batchStatus, run.SuccessCount, run.FailureCount, run.StartedAt, run.FinishedAt, item.DurationMs/1000, run.UpdatedAt, run.SourceID)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return errors.New("batch source task is missing")
		}
	}
	return upsertDesktopActivity(tx, item)
}

// Source results and per-target activity commit together. The logical parent
// work is counted once; target outcomes remain independently inspectable.
func projectDesktopTaskTarget(tx *sql.Tx, result desktopBatchTaskResult, output *protocol.ContentReference) error {
	parent, err := scanDesktopTaskRun(tx.QueryRow(desktopTaskSelectSQL+" WHERE source_type='desktop_batch_task' AND source_id=?", result.TaskID))
	if err != nil {
		return err
	}
	status := DesktopActivityLogFailure
	if result.Status == "success" {
		status = DesktopActivityLogSuccess
	}
	if result.Status == "canceled" || result.Status == "unknown" {
		status = DesktopActivityLogStatus(result.Status)
	}
	item := DesktopActivityLogItem{ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte("desktop_batch_task_results:"+result.ID)).String(),
		Actor: parent.Actor, WorkID: uuid.NewSHA1(uuid.NameSpaceOID, []byte(parent.WorkID+":"+result.ServerID)).String(), ParentWorkID: parent.WorkID, WorkStartedAt: parent.WorkStartedAt, Attempt: parent.Attempt,
		SourceTable: "desktop_batch_task_results", SourceID: result.ID, Action: parent.TaskType, Resource: parent.Resource, Status: status, ServerID: result.ServerID, ServerName: result.ServerName,
		StartedAt: result.StartedAt, FinishedAt: result.CompletedAt, CreatedAt: result.StartedAt, DurationMs: result.DurationMs, TotalCount: 1, Detail: result.Output, DetailContent: output, ErrorMessage: result.ErrorMessage}
	if result.Status == "success" {
		item.SuccessCount = 1
	} else if result.Status == "failed" {
		item.FailureCount = 1
	}
	return upsertDesktopActivity(tx, item)
}

func desktopActivityKind(action string) activitystats.Kind {
	switch action {
	case "connection", "ssh_connect":
		return activitystats.TypeConnection
	case "sftp_upload", "sftp_download", "sftp_transfer":
		return activitystats.TypeTransfer
	case "command", "command_execute", "script", "script_execute", "sftp_recursive_delete", "sftp_delete", "sftp_mkdir", "sftp_rename", "sftp_chmod", "sftp_write",
		"docker_start", "docker_stop", "docker_restart", "docker_pause", "docker_unpause", "docker_remove":
		return activitystats.TypeExecution
	default:
		return activitystats.TypeAudit
	}
}

func addDesktopActivityResources(tx *sql.Tx, sourceTable, sourceID string, resources []activitystats.Resource) error {
	if len(resources) == 0 {
		return nil
	}
	var id string
	if err := tx.QueryRow(`SELECT id FROM activity_logs WHERE source_table=? AND source_id=?`, sourceTable, sourceID).Scan(&id); err != nil {
		return err
	}
	for _, resource := range resources {
		if resource.ServerID == "" {
			continue
		}
		if resource.Name == "" {
			err := tx.QueryRow(`SELECT name FROM desktop_servers WHERE id=?`, resource.ServerID).Scan(&resource.Name)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		if _, err := tx.Exec(`INSERT INTO desktop_activity_resources(activity_id,server_id,name) VALUES(?,?,?) ON CONFLICT(activity_id,server_id) DO NOTHING`, id, resource.ServerID, resource.Name); err != nil {
			return err
		}
	}
	return nil
}
