package jobqueue

import (
	"errors"
	"time"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A queued TaskRun is proof that the command executor has not admitted SSH
// work: it commits running before issuing commands. Settle only this phase in
// the queue transaction. Running outcomes belong to the execution recorder.
func settleUnstartedExecution(tx *gorm.DB, bodies taskcenter.Bodies, job *Job, status Status, message string, finished time.Time) (*taskcenter.TaskRun, error) {
	if (job.Kind != "batch.execute" && job.Kind != "task.execute") || job.SourceType != "task_run" || job.MaxAttempts != 1 || !job.Actor.Valid() {
		return nil, nil
	}
	id, err := uuid.Parse(job.SourceID)
	if err != nil || id == uuid.Nil || (job.Kind == "batch.execute" && id != job.ID) {
		return nil, nil
	}
	var run taskcenter.TaskRun
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "work_id", "actor_kind", "actor_id", "actor_session_id", "actor_grant_id", "status", "source_type", "source_id", "progress", "stage").Where("id = ?", id).First(&run).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if run.Actor != job.Actor || run.Status != taskcenter.StatusQueued {
		return nil, nil
	}
	if job.Kind == "batch.execute" && (run.SourceType != "batch_task" || run.SourceID != id.String()) {
		return nil, nil
	}
	if job.Kind == "task.execute" && run.SourceType != "scheduled_task" {
		return nil, nil
	}
	outcome, code := taskcenter.StatusFailed, "dispatch_failed_before_start"
	if status == StatusCancelled {
		outcome, code = taskcenter.StatusCanceled, "dispatch_cancelled_before_start"
	}
	if message == "" {
		message = "Queue dispatch ended before command execution began"
	}
	changed, err := taskcenter.NewTransactionRepository(tx, bodies).UpdateIfStatus(tx.Statement.Context, id, []taskcenter.Status{taskcenter.StatusQueued}, map[string]any{
		"status": outcome, "finished_at": finished, "error_code": code, "error_message": message, "cancelable": false, "retryable": false,
	})
	if err != nil || !changed {
		return nil, err
	}
	run.Status = outcome
	return &run, nil
}
