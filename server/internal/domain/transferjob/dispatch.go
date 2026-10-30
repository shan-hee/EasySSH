package transferjob

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"gorm.io/gorm"
)

// The queue row is an execution outbox in the same database transaction as the
// source. No caller may publish queued and then separately enqueue remote work.
func projectAndDispatch(tx *gorm.DB, job *TransferJob, bodies taskcenter.Bodies) error {
	if job.Status == JobStatusQueued {
		if err := ensureTaskRunTx(tx, job, bodies); err != nil {
			return err
		}
		if err := ensureDispatchTx(tx, job); err != nil {
			return err
		}
	}
	return projectJob(tx, job)
}

func ensureDispatchTx(tx *gorm.DB, job *TransferJob) error {
	payload, err := json.Marshal(map[string]string{"job_id": job.ID.String()})
	if err != nil {
		return err
	}
	key := "transfer.execute:" + job.ID.String()
	queued := &jobqueue.Job{
		ID: job.ID, Actor: job.Actor, Kind: "transfer.execute", SourceType: "transfer_job", SourceID: job.ID.String(),
		DedupeKey: &key, PayloadJSON: string(payload), Status: jobqueue.StatusQueued, MaxAttempts: 3,
	}
	if err := jobqueue.NewRepository(tx, nil, nil).Create(tx.Statement.Context, queued); err != nil {
		return err
	}
	if queued.ID != job.ID || queued.Actor != job.Actor || queued.Kind != "transfer.execute" || queued.SourceType != "transfer_job" || queued.SourceID != job.ID.String() || queued.PayloadJSON != string(payload) {
		return ErrOutcomeConflict
	}
	// The source is still queued, so no remote executor has been admitted.
	// An exhausted/rejected queue attempt must settle the source as well.
	switch queued.Status {
	case jobqueue.StatusFailed, jobqueue.StatusCancelled, jobqueue.StatusSucceeded:
		job.Status = JobStatusFailed
		if queued.Status == jobqueue.StatusCancelled {
			job.Status = JobStatusCancelled
		}
		job.ErrorMessage = fmt.Sprintf("dispatch ended before transfer execution: %s", queued.Status)
		if queued.LastError != "" {
			job.ErrorMessage += ": " + queued.LastError
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		job.FinishedAt, job.SpeedBps = &now, 0
		return tx.Model(&TransferJob{}).Where("id = ? AND status = ?", job.ID, JobStatusQueued).Updates(map[string]interface{}{
			"status": job.Status, "error_message": job.ErrorMessage, "finished_at": job.FinishedAt, "speed_bps": 0,
		}).Error
	}
	return nil
}
