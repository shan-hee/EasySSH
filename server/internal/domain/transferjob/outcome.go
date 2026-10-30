package transferjob

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/resultstore"
	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
)

var ErrOutcomeConflict = errors.New("transfer_outcome_conflict")

func (s *service) finishExecution(ctx context.Context, job *TransferJob, cause error, stage JobStage) error {
	_, err := s.saveTerminal(ctx, observedOutcome(ctx, job, cause, stage), []JobStatus{JobStatusRunning, JobStatusCanceling}, false)
	return err
}

func observedOutcome(ctx context.Context, job *TransferJob, cause error, stage JobStage) *TransferJob {
	if cause != nil && ctx.Err() != nil && !errors.Is(cause, ctx.Err()) {
		cause = errors.Join(cause, ctx.Err())
	}
	observed := cloneJob(job)
	observed.Status, observed.Stage, observed.SpeedBps = executionOutcome(cause), stage, 0
	observed.ErrorMessage = ""
	if cause != nil {
		observed.ErrorMessage = cause.Error()
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	observed.FinishedAt = &now
	if observed.Status == JobStatusCompleted {
		observed.Progress = 100
		observed.BytesCompleted = observed.BytesProcessed
		observed.FilesCompleted = observed.FilesTotal
	}
	return observed
}

// saveResult retries database writes only. The source record, not an in-memory
// receipt, remains authoritative when storage cannot recover within the deadline.
func (s *service) saveResult(ctx context.Context, id uuid.UUID, save func(context.Context) (*TransferJob, error)) (*TransferJob, error) {
	var saved *TransferJob
	err := resultstore.Write(ctx, func(attempt context.Context) error {
		var err error
		saved, err = save(attempt)
		if err == nil {
			err = s.syncTaskRun(attempt, saved.ID)
		}
		if errors.Is(err, taskcenter.ErrTransferOutcomeConflict) || errors.Is(err, ErrOutcomeConflict) {
			return resultstore.Permanent(ErrOutcomeConflict)
		}
		if errors.Is(err, ErrJobNotFound) || errors.Is(err, ErrForbiddenJob) {
			return resultstore.Permanent(err)
		}
		return err
	})
	if err != nil {
		log.Printf("[TransferJob] save result: job=%s error=%v", id, err)
		return nil, err
	}
	return saved, nil
}

func (s *service) saveAdmission(ctx context.Context, job *TransferJob) (*TransferJob, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	snapshot := cloneJob(job)
	if snapshot.TaskRunID != nil {
		snapshot.ID = *snapshot.TaskRunID
	} else if snapshot.ID == uuid.Nil {
		snapshot.ID = uuid.New()
	}
	if snapshot.CreatedAt.IsZero() {
		snapshot.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	}
	return s.saveResult(ctx, snapshot.ID, func(attempt context.Context) (*TransferJob, error) {
		candidate := cloneJob(snapshot)
		err := s.repo.Create(attempt, candidate)
		return candidate, err
	})
}

func (s *service) saveStaged(ctx context.Context, job *TransferJob) (*TransferJob, error) {
	snapshot := cloneJob(job)
	snapshot.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	// Serialize staging handoff with input binding and artifact removal.
	s.artifactMu.Lock()
	defer s.artifactMu.Unlock()
	return s.saveResult(ctx, snapshot.ID, func(attempt context.Context) (*TransferJob, error) {
		return s.persistStaged(attempt, snapshot)
	})
}

func (s *service) savePreparationFailure(ctx context.Context, job *TransferJob, cause error) (*TransferJob, error) {
	from := []JobStatus{JobStatusCreated, JobStatusQueued}
	if job.Stage == JobStageStaging {
		from = []JobStatus{JobStatusStaging, JobStatusCanceling}
	}
	return s.saveTerminal(ctx, observedOutcome(ctx, job, cause, job.Stage), from, true)
}

func (s *service) saveTerminal(ctx context.Context, job *TransferJob, from []JobStatus, preparation bool) (*TransferJob, error) {
	return s.saveResult(ctx, job.ID, func(attempt context.Context) (*TransferJob, error) {
		return s.persistTerminal(attempt, job, from, preparation)
	})
}

func executionOutcome(err error) JobStatus {
	switch {
	case err == nil:
		return JobStatusCompleted
	case errors.Is(err, sftputil.ErrMutationOutcomeUnknown):
		return JobStatusUnknown
	case errors.Is(err, context.Canceled):
		return JobStatusCancelled
	default:
		return JobStatusFailed
	}
}

func (s *service) persistTerminal(ctx context.Context, job *TransferJob, from []JobStatus, preparation bool) (*TransferJob, error) {
	updates := map[string]interface{}{
		"status": job.Status, "stage": job.Stage, "error_message": job.ErrorMessage,
		"finished_at": job.FinishedAt, "progress": job.Progress, "speed_bps": 0,
		"bytes_total": job.BytesTotal, "bytes_processed": job.BytesProcessed,
		"bytes_completed": job.BytesCompleted, "files_total": job.FilesTotal, "files_completed": job.FilesCompleted, "result_path": job.ResultPath,
	}
	if preparation || job.Kind == JobKindSFTPDownload && job.Status == JobStatusCompleted {
		updates["artifact_path"], updates["artifact_name"], updates["artifact_size"] = job.ArtifactPath, job.ArtifactName, job.ArtifactSize
	}
	updated, err := s.repo.UpdateIfStatus(ctx, job.ID, from, updates)
	if err != nil {
		return nil, err
	}
	saved, err := s.repo.GetByID(ctx, job.ID)
	if err != nil {
		return nil, err
	}
	if !updated && !sameOutcome(saved, job) {
		if preparation {
			// Admission/cancellation has already won the source CAS. A late
			// preparation error has no authority over the execution result.
			if sameAdmission(saved, job) && saved.Status != JobStatusStaging && saved.Status != JobStatusCreated {
				return saved, nil
			}
		}
		return nil, ErrOutcomeConflict
	}
	return saved, nil
}

func (s *service) persistStaged(ctx context.Context, job *TransferJob) (*TransferJob, error) {
	updates := map[string]interface{}{
		"artifact_path": job.ArtifactPath, "artifact_name": job.ArtifactName, "artifact_size": job.ArtifactSize,
		"bytes_total": job.BytesTotal, "bytes_processed": job.BytesProcessed,
		"bytes_completed": job.BytesCompleted, "files_total": job.FilesTotal, "files_completed": job.FilesCompleted, "result_path": job.ResultPath, "progress": job.Progress,
		"status": job.Status, "stage": job.Stage,
	}
	_, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusStaging}, updates)
	if err != nil {
		return nil, err
	}
	saved, err := s.repo.GetByID(ctx, job.ID)
	if err != nil {
		return nil, err
	}
	if !sameAdmission(saved, job) {
		return nil, ErrOutcomeConflict
	}
	if saved.Status == JobStatusCanceling && saved.Stage == JobStageStaging {
		now := job.UpdatedAt
		updates["status"], updates["stage"] = JobStatusCancelled, JobStageStaging
		updates["bytes_processed"], updates["progress"] = job.ArtifactSize, 100
		updates["finished_at"], updates["error_message"], updates["speed_bps"] = &now, "upload staging cancelled before dispatch", 0
		if _, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusCanceling}, updates); err != nil {
			return nil, err
		}
		saved, err = s.repo.GetByID(ctx, job.ID)
		if err != nil {
			return nil, err
		}
	}
	if saved.Status == JobStatusStaging || saved.ArtifactPath != job.ArtifactPath || saved.ArtifactSize != job.ArtifactSize {
		return nil, ErrOutcomeConflict
	}
	return saved, nil
}

func sameOutcome(saved, observed *TransferJob) bool {
	return saved != nil && saved.Actor == observed.Actor && saved.Status == observed.Status &&
		saved.Stage == observed.Stage && saved.ErrorMessage == observed.ErrorMessage &&
		saved.BytesTotal == observed.BytesTotal && saved.BytesProcessed == observed.BytesProcessed &&
		saved.BytesCompleted == observed.BytesCompleted && saved.FilesTotal == observed.FilesTotal && saved.FilesCompleted == observed.FilesCompleted && saved.ResultPath == observed.ResultPath &&
		saved.Progress == observed.Progress && saved.FinishedAt != nil && observed.FinishedAt != nil &&
		// SQL timestamp precision can be lower than the Go clock. The outcome
		// fields and original finish instant must agree; never restamp retries.
		saved.FinishedAt.UTC().Truncate(time.Millisecond).Equal(observed.FinishedAt.UTC().Truncate(time.Millisecond)) &&
		(observed.Kind != JobKindSFTPDownload || observed.Status != JobStatusCompleted ||
			(saved.ArtifactPath == observed.ArtifactPath && saved.ArtifactSize == observed.ArtifactSize && saved.ArtifactName == observed.ArtifactName))
}

func cloneJob(job *TransferJob) *TransferJob {
	if job == nil {
		return nil
	}
	copy := *job
	copy.SourceServerID, copy.TargetServerID = copyValue(job.SourceServerID), copyValue(job.TargetServerID)
	copy.ScheduledTaskID, copy.TaskRunID = copyValue(job.ScheduledTaskID), copyValue(job.TaskRunID)
	copy.ArtifactCleanedAt, copy.ArtifactExpiresAt = copyValue(job.ArtifactCleanedAt), copyValue(job.ArtifactExpiresAt)
	copy.StartedAt, copy.FinishedAt = copyValue(job.StartedAt), copyValue(job.FinishedAt)
	return &copy
}

func copyValue[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
