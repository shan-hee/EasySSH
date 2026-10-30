package transferjob

import (
	"encoding/json"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// projectJob shares the source transaction. Artifact retention never changes
// execution outcome, completion time, or the identity of the logical work.
func projectJob(tx *gorm.DB, job *TransferJob) error {
	status := operationrecord.StatusPending
	switch job.Status {
	case JobStatusRunning, JobStatusCanceling:
		status = operationrecord.StatusRunning
	case JobStatusUnknown:
		status = operationrecord.StatusUnknown
	case JobStatusCompleted:
		status = operationrecord.StatusSuccess
	case JobStatusFailed:
		status = operationrecord.StatusFailure
	case JobStatusCancelled:
		status = operationrecord.StatusCanceled
	}
	workID, workStarted, attempt := job.ID, job.CreatedAt, 1
	var parentID *uuid.UUID
	if job.TaskRunID != nil {
		var run taskcenter.TaskRun
		if err := tx.Where("id = ?", *job.TaskRunID).First(&run).Error; err != nil {
			return err
		}
		if run.Actor != job.Actor {
			return ErrForbiddenJob
		}
		if run.SourceType == "transfer_job" && run.SourceID != job.ID.String() {
			return ErrOutcomeConflict
		}
		if run.SourceType != "transfer_job" {
			// Scheduled preparation hands this attempt to the durable transfer
			// in the same transaction. Queue redelivery and restart recovery can
			// now identify who owns the actual execution outcome.
			result := tx.Model(&taskcenter.TaskRun{}).Where("id = ? AND source_type = ? AND status IN ?", run.ID, run.SourceType, []taskcenter.Status{taskcenter.StatusQueued, taskcenter.StatusRunning}).Updates(map[string]interface{}{
				"source_type": "transfer_job", "source_id": job.ID.String(),
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return ErrOutcomeConflict
			}
		}
		if total := max(1, job.FilesTotal); run.TotalCount != total {
			if err := tx.Model(&taskcenter.TaskRun{}).Where("id = ?", run.ID).Update("total_count", total).Error; err != nil {
				return err
			}
		}
		workID, workStarted, attempt, parentID = run.WorkID, run.WorkStartedAt, run.Attempt, run.ParentWorkID
	}
	source := "manual"
	if job.ScheduledTaskID != nil && job.Stage != JobStageStaging {
		source = "automation"
	}
	if job.Actor.GrantID != "" {
		source = "share"
	}
	detail, err := json.Marshal(map[string]interface{}{"job_id": job.ID, "kind": job.Kind, "stage": job.Stage, "artifact_expires_at": job.ArtifactExpiresAt, "artifact_cleaned_at": job.ArtifactCleanedAt, "result_path": job.ResultPath, "files_total": job.FilesTotal, "files_completed": job.FilesCompleted, "bytes_completed": job.BytesCompleted})
	if err != nil {
		return err
	}
	record := &operationrecord.OperationRecord{
		Actor: job.Actor, WorkID: workID, WorkStartedAt: workStarted, ParentWorkID: parentID, Attempt: attempt,
		Type: operationrecord.TypeTransfer, Category: operationrecord.CategoryActivity, Action: string(job.Kind), Status: status,
		Title: job.Name, Resource: transferJobResource(job), Source: source,
		StartedAt: job.StartedAt, FinishedAt: job.FinishedAt, Progress: job.Progress,
		BytesTotal: job.BytesTotal, BytesProcessed: job.BytesProcessed, BytesCompleted: job.BytesCompleted, SpeedBps: job.SpeedBps,
		ErrorMessage: job.ErrorMessage, DetailJSON: string(detail), SourceTable: "transfer_jobs", SourceID: job.ID.String(),
		CreatedAt: job.CreatedAt, UpdatedAt: time.Now().UTC(), TotalCount: 1,
	}
	// Successful work and committed files are different metrics: an empty
	// directory is a successful transfer with zero successful files.
	record.SuccessCount = job.FilesCompleted
	if job.Status == JobStatusFailed {
		record.FailureCount = 1
	}
	if job.FilesTotal > 0 || job.Kind == JobKindSFTPTransfer {
		record.TotalCount = job.FilesTotal
		if record.TotalCount == 0 {
			record.TotalCount = 1
		}
	}
	if job.StartedAt != nil && job.FinishedAt != nil {
		record.DurationMs = job.FinishedAt.Sub(*job.StartedAt).Milliseconds()
	}
	for _, id := range []*uuid.UUID{job.SourceServerID, job.TargetServerID} {
		if id == nil || *id == uuid.Nil {
			continue
		}
		// The projection repository preserves the first nonempty resource snapshot.
		var server struct{ Name string }
		if err := tx.Table("servers").Select("name").Where("id = ?", *id).Scan(&server).Error; err != nil {
			return err
		}
		record.Resources = append(record.Resources, operationrecord.ResourceSnapshot{ServerID: *id, Name: server.Name})
		record.ServerID, record.ServerName = id, server.Name
	}
	if err := operationrecord.NewRepository(tx, nil).Upsert(tx.Statement.Context, record); err != nil {
		return err
	}
	if job.TaskRunID != nil {
		preparation := tx.Model(&operationrecord.OperationRecord{}).Select("id").Where("source_table = ? AND source_id = ? AND type = ?", "task_runs", job.TaskRunID.String(), operationrecord.TypeTransfer)
		if err := tx.Where("record_id IN (?)", preparation).Delete(&operationrecord.Resource{}).Error; err != nil {
			return err
		}
		// Projection replacement is not retention or a user deletion: preserve
		// coverage and let exactly one source own this attempt's activity.
		if err := tx.Unscoped().Where("source_table = ? AND source_id = ? AND type = ?", "task_runs", job.TaskRunID.String(), operationrecord.TypeTransfer).Delete(&operationrecord.OperationRecord{}).Error; err != nil {
			return err
		}
	}
	return nil
}
