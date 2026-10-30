package transferjob

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrJobNotFound = errors.New("transfer job not found")

type Repository interface {
	CheckScheduledStage(context.Context, *TransferJob) error
	Create(ctx context.Context, job *TransferJob) error
	EnsureTaskRun(context.Context, uuid.UUID) (*TransferJob, error)
	Update(ctx context.Context, id uuid.UUID, updates map[string]interface{}) error
	AttachScheduledTask(ctx context.Context, id uuid.UUID, scheduledTaskID uuid.UUID) (bool, error)
	UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []JobStatus, updates map[string]interface{}) (bool, error)
	ClaimUploadInput(context.Context, uuid.UUID, time.Time) (bool, error)
	GetByID(ctx context.Context, id uuid.UUID) (*TransferJob, error)
	GetVisible(ctx context.Context, id uuid.UUID) (*TransferJob, error)
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	GetStatistics(ctx context.Context) (*protocol.TransferStatistics, error)
	FindExpired(ctx context.Context, before time.Time, limit int) ([]*TransferJob, error)
	HasActiveArtifactReference(ctx context.Context, artifactPath string, excludeID uuid.UUID) (bool, error)
	RecoverInterrupted(ctx context.Context) ([]*TransferJob, error)
	ReconcileDispatch(context.Context) ([]*TransferJob, error)
	Delete(ctx context.Context, id uuid.UUID) error
}

type repository struct {
	bodies taskcenter.Bodies
	events *realtime.Hub
	db     *gorm.DB
}

func NewRepository(db *gorm.DB, events *realtime.Hub, bodies taskcenter.Bodies) Repository {
	return &repository{db: db, events: events, bodies: bodies}
}

func (r *repository) Create(ctx context.Context, job *TransferJob) error {
	if !job.Actor.Valid() {
		return ErrForbiddenJob
	}
	if job.ID == uuid.Nil {
		job.ID = uuid.New()
	}
	if job.CreatedAt.IsZero() {
		job.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	}
	candidate := cloneJob(job)
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(candidate)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			existing, err := (&repository{db: tx}).GetByID(ctx, job.ID)
			if err != nil {
				return err
			}
			if !sameAdmission(existing, job) {
				return ErrOutcomeConflict
			}
			candidate = existing
		}
		return projectAndDispatch(tx, candidate, r.bodies)
	})
	if err == nil {
		*job = *cloneJob(candidate)
		r.publish(job)
	}
	return err
}

func sameAdmission(saved, requested *TransferJob) bool {
	return saved.ID == requested.ID && saved.Actor == requested.Actor && saved.Kind == requested.Kind &&
		saved.Name == requested.Name && saved.Description == requested.Description && saved.DetailJSON == requested.DetailJSON && saved.ArtifactManaged == requested.ArtifactManaged &&
		(saved.Kind != JobKindSFTPUpload || saved.BytesTotal == requested.BytesTotal) &&
		samePointer(saved.SourceServerID, requested.SourceServerID) && samePointer(saved.TargetServerID, requested.TargetServerID) &&
		saved.SourcePath == requested.SourcePath && saved.TargetPath == requested.TargetPath && saved.FileName == requested.FileName &&
		samePointer(saved.ScheduledTaskID, requested.ScheduledTaskID) &&
		(requested.TaskRunID == nil || samePointer(saved.TaskRunID, requested.TaskRunID))
}

func samePointer[T comparable](left, right *T) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

// EnsureTaskRun commits the attempt and its source reference together.
func (r *repository) EnsureTaskRun(ctx context.Context, id uuid.UUID) (*TransferJob, error) {
	var job *TransferJob
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		var err error
		job, err = (&repository{db: tx}).GetByID(ctx, id)
		if err != nil {
			return err
		}
		if err := ensureTaskRunTx(tx, job, r.bodies); err != nil {
			return err
		}
		return projectAndDispatch(tx, job, r.bodies)
	})
	if err == nil {
		r.publish(job)
	}
	return job, err
}

func ensureTaskRunTx(tx *gorm.DB, job *TransferJob, bodies taskcenter.Bodies) error {
	if job.TaskRunID != nil || job.Status == JobStatusCreated || job.Status == JobStatusStaging {
		return nil
	}
	run := &taskcenter.TaskRun{
		ID: job.ID, WorkID: job.ID, WorkStartedAt: job.CreatedAt, Actor: job.Actor,
		TaskType: string(job.Kind), Title: job.Name, Description: job.Description,
		TriggerType: taskcenter.TriggerManual, Runner: job.Runner, Status: taskcenter.StatusQueued,
		SourceType: "transfer_job", SourceID: job.ID.String(), Resource: transferJobResource(job),
		Retryable: job.ScheduledTaskID != nil, BytesTotal: job.BytesTotal,
	}
	if job.ScheduledTaskID != nil {
		run.DefinitionID, run.TriggerType = job.ScheduledTaskID, taskcenter.TriggerScheduled
	}
	created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(run)
	if created.Error != nil {
		return created.Error
	}
	if created.RowsAffected > 0 {
		if err := taskcenter.StoreBody(tx, bodies, run); err != nil {
			return err
		}
		if err := tx.Create(&taskcenter.TaskEvent{TaskRunID: run.ID, Level: "info", Message: "传输任务已进入队列"}).Error; err != nil {
			return err
		}
	} else {
		var existing taskcenter.TaskRun
		if err := tx.Where("id = ?", run.ID).First(&existing).Error; err != nil {
			return err
		}
		if existing.Actor != job.Actor || existing.SourceType != "transfer_job" || existing.SourceID != job.ID.String() {
			return ErrOutcomeConflict
		}
	}
	if err := tx.Model(&TransferJob{}).Where("id = ? AND task_run_id IS NULL", job.ID).Update("task_run_id", run.ID).Error; err != nil {
		return err
	}
	var attached TransferJob
	if err := tx.Where("id = ?", job.ID).First(&attached).Error; err != nil {
		return err
	}
	if attached.TaskRunID == nil || *attached.TaskRunID != run.ID {
		return ErrOutcomeConflict
	}
	job.TaskRunID = &run.ID
	return nil
}

func (r *repository) Update(ctx context.Context, id uuid.UUID, updates map[string]interface{}) error {
	var changed *TransferJob
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		if err := tx.Model(&TransferJob{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		job, err := (&repository{db: tx}).GetByID(ctx, id)
		if err != nil {
			return err
		}
		changed = job
		return projectAndDispatch(tx, job, r.bodies)
	})
	if err == nil {
		r.publish(changed)
	}
	return err
}

func (r *repository) AttachScheduledTask(ctx context.Context, id uuid.UUID, scheduledTaskID uuid.UUID) (bool, error) {
	var job *TransferJob
	attached := false
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		result := tx.Model(&TransferJob{}).
			Where("id = ? AND status = ? AND kind = ? AND artifact_managed = ? AND artifact_cleaned_at IS NULL AND (scheduled_task_id IS NULL OR scheduled_task_id = ?)", id, JobStatusCreated, JobKindSFTPUpload, true, scheduledTaskID).
			Updates(map[string]interface{}{"scheduled_task_id": &scheduledTaskID, "artifact_expires_at": nil})
		if result.Error != nil {
			return result.Error
		}
		var err error
		job, err = (&repository{db: tx}).GetByID(ctx, id)
		if err != nil {
			return err
		}
		attached = job.Status == JobStatusCreated && job.Kind == JobKindSFTPUpload && job.ArtifactManaged && job.ArtifactCleanedAt == nil && job.ScheduledTaskID != nil && *job.ScheduledTaskID == scheduledTaskID
		if result.RowsAffected > 0 {
			return projectAndDispatch(tx, job, r.bodies)
		}
		return nil
	})
	if err == nil && attached {
		r.publish(job)
	}
	return attached, err
}

func (r *repository) UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []JobStatus, updates map[string]interface{}) (bool, error) {
	if len(statuses) == 0 {
		return false, nil
	}
	changed := false
	var updated *TransferJob
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		result := tx.Model(&TransferJob{}).Where("id = ? AND status IN ?", id, statuses).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		changed = result.RowsAffected > 0
		if !changed {
			return nil
		}
		job, err := (&repository{db: tx}).GetByID(ctx, id)
		if err != nil {
			return err
		}
		updated = job
		return projectAndDispatch(tx, job, r.bodies)
	})
	if err == nil && changed {
		r.publish(updated)
	}
	return changed, err
}

// Created can also mean a finished scheduled-task input. The stage predicate
// prevents a delayed request from reclaiming that input after another upload.
func (r *repository) ClaimUploadInput(ctx context.Context, id uuid.UUID, started time.Time) (bool, error) {
	var updated *TransferJob
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		result := tx.Model(&TransferJob{}).
			Where("id = ? AND kind = ? AND status = ? AND stage = ? AND (artifact_path IS NULL OR artifact_path = '') AND scheduled_task_id IS NULL AND artifact_cleaned_at IS NULL AND artifact_expires_at > ?", id, JobKindSFTPUpload, JobStatusCreated, JobStageAwaitingInput, started).
			Updates(map[string]interface{}{"status": JobStatusStaging, "stage": JobStageStaging, "started_at": &started})
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		job, err := (&repository{db: tx}).GetByID(ctx, id)
		if err != nil {
			return err
		}
		updated = job
		return projectAndDispatch(tx, job, r.bodies)
	})
	if err == nil && updated != nil {
		r.publish(updated)
	}
	return err == nil && updated != nil, err
}

func (r *repository) GetByID(ctx context.Context, id uuid.UUID) (*TransferJob, error) {
	var job TransferJob
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&job).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJobNotFound
		}
		return nil, err
	}
	return &job, nil
}

func (r *repository) GetVisible(ctx context.Context, id uuid.UUID) (*TransferJob, error) {
	var job TransferJob
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	if err := query.Where("id = ?", id).First(&job).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJobNotFound
		}
		return nil, err
	}
	return &job, nil
}

func (r *repository) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	if req == nil {
		req = &ListRequest{}
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.PageSize < 1 {
		req.PageSize = 20
	}
	if req.PageSize > 100 {
		req.PageSize = 100
	}

	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx).Model(&TransferJob{}))
	if err != nil {
		return nil, err
	}
	if req.Kind != "" {
		query = query.Where("kind = ?", req.Kind)
	}
	if req.Status != "" {
		query = query.Where("status = ?", req.Status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var jobs []*TransferJob
	if err := query.
		Order("created_at DESC").
		Limit(req.PageSize).
		Offset((req.Page - 1) * req.PageSize).
		Find(&jobs).Error; err != nil {
		return nil, err
	}

	totalPages := int(total) / req.PageSize
	if int(total)%req.PageSize > 0 {
		totalPages++
	}

	return &ListResponse{
		Jobs:       jobs,
		Total:      total,
		Page:       req.Page,
		PageSize:   req.PageSize,
		TotalPages: totalPages,
	}, nil
}

func (r *repository) GetStatistics(ctx context.Context) (*protocol.TransferStatistics, error) {
	stats := &protocol.TransferStatistics{}
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx).Model(&TransferJob{}))
	if err != nil {
		return nil, err
	}

	if err := query.Count(&stats.Total).Error; err != nil {
		return nil, err
	}

	countStatus := func(status JobStatus, target *int64) error {
		return query.Session(&gorm.Session{}).Where("status = ?", status).Count(target).Error
	}
	if err := countStatus(JobStatusQueued, &stats.Queued); err != nil {
		return nil, err
	}
	if err := countStatus(JobStatusRunning, &stats.Running); err != nil {
		return nil, err
	}
	if err := countStatus(JobStatusCanceling, &stats.Canceling); err != nil {
		return nil, err
	}
	if err := countStatus(JobStatusUnknown, &stats.Unknown); err != nil {
		return nil, err
	}
	if err := countStatus(JobStatusCompleted, &stats.Completed); err != nil {
		return nil, err
	}
	if err := countStatus(JobStatusFailed, &stats.Failed); err != nil {
		return nil, err
	}
	if err := countStatus(JobStatusCancelled, &stats.Cancelled); err != nil {
		return nil, err
	}
	if err := query.Session(&gorm.Session{}).Where("artifact_expires_at IS NOT NULL AND artifact_expires_at <= ?", time.Now().UTC()).Count(&stats.Expired).Error; err != nil {
		return nil, err
	}

	sumQuery := query.Session(&gorm.Session{})
	var sums struct {
		BytesTotal     int64
		BytesProcessed int64
		BytesCompleted int64
		FilesCompleted int64
		StorageBytes   int64
	}
	if err := sumQuery.
		Select("COALESCE(SUM(bytes_total), 0) AS bytes_total, COALESCE(SUM(bytes_processed), 0) AS bytes_processed, COALESCE(SUM(bytes_completed), 0) AS bytes_completed, COALESCE(SUM(files_completed), 0) AS files_completed, COALESCE(SUM(artifact_size), 0) AS storage_bytes").
		Scan(&sums).Error; err != nil {
		return nil, err
	}
	stats.BytesTotal = sums.BytesTotal
	stats.BytesProcessed = sums.BytesProcessed
	stats.StorageBytes = sums.StorageBytes
	stats.BytesCompleted, stats.FilesCompleted = sums.BytesCompleted, sums.FilesCompleted

	return stats, nil
}

func (r *repository) FindExpired(ctx context.Context, before time.Time, limit int) ([]*TransferJob, error) {
	if limit <= 0 {
		limit = 100
	}
	var jobs []*TransferJob
	err := r.db.WithContext(ctx).
		Where("artifact_cleaned_at IS NULL AND artifact_expires_at IS NOT NULL AND artifact_expires_at < ? AND status IN ?", before, []JobStatus{
			JobStatusCreated,
			JobStatusCompleted,
			JobStatusFailed,
			JobStatusCancelled,
			JobStatusUnknown,
		}).
		Order("artifact_expires_at ASC").
		Limit(limit).
		Find(&jobs).Error
	return jobs, err
}

func (r *repository) HasActiveArtifactReference(ctx context.Context, artifactPath string, excludeID uuid.UUID) (bool, error) {
	if artifactPath == "" {
		return false, nil
	}
	var count int64
	query := r.db.WithContext(ctx).
		Model(&TransferJob{}).
		Where("artifact_path = ? AND status IN ?", artifactPath, []JobStatus{
			JobStatusStaging,
			JobStatusQueued,
			JobStatusRunning,
			JobStatusCanceling,
		})
	if excludeID != uuid.Nil {
		query = query.Where("id <> ?", excludeID)
	}
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// RecoverInterrupted runs before any queue worker is admitted. Queued work has
// not entered the executor; running work may have committed a remote mutation.
// Include terminal sources whose task projection still needs reconciliation.
func (r *repository) RecoverInterrupted(ctx context.Context) ([]*TransferJob, error) {
	var recovered []*TransferJob
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		activeRuns := tx.Table("task_runs").Select("id").Where("status IN ?", []string{"queued", "running", "canceling"})
		var jobs []TransferJob
		return tx.Model(&TransferJob{}).Where("status IN ? OR task_run_id IN (?)", []JobStatus{JobStatusStaging, JobStatusQueued, JobStatusRunning, JobStatusCanceling}, activeRuns).FindInBatches(&jobs, 100, func(batch *gorm.DB, _ int) error {
			for i := range jobs {
				job := &jobs[i]
				status, message := interruptedOutcome(job)
				if status != job.Status {
					now := time.Now().UTC()
					job.Status, job.FinishedAt, job.ErrorMessage, job.SpeedBps = status, &now, message, 0
					if err := tx.Model(&TransferJob{}).Where("id = ?", job.ID).Updates(map[string]interface{}{
						"status": job.Status, "finished_at": job.FinishedAt, "error_message": job.ErrorMessage, "speed_bps": 0,
					}).Error; err != nil {
						return err
					}
				}
				if err := projectAndDispatch(tx, job, r.bodies); err != nil {
					return err
				}
				copy := *job
				recovered = append(recovered, &copy)
			}
			return nil
		}).Error
	})
	return recovered, err
}

func interruptedOutcome(job *TransferJob) (JobStatus, string) {
	switch job.Status {
	case JobStatusStaging:
		return JobStatusFailed, "upload staging interrupted by server restart; remote transfer was not started"
	case JobStatusRunning:
		return JobStatusUnknown, "transfer interrupted by server restart; outcome unknown; not replayed"
	case JobStatusCanceling:
		if job.Stage == JobStageStaging {
			return JobStatusCancelled, "upload staging cancelled; remote transfer was not started"
		}
		return JobStatusUnknown, "server restarted while cancelling transfer; outcome unknown; not replayed"
	default:
		return job.Status, job.ErrorMessage
	}
}

// Reconcile dispatch failures even when no further delivery can reach the
// handler. Source queued guarantees that no remote execution was admitted.
func (r *repository) ReconcileDispatch(ctx context.Context) ([]*TransferJob, error) {
	var ids []uuid.UUID
	terminal := []JobStatus{JobStatusCompleted, JobStatusFailed, JobStatusCancelled, JobStatusUnknown}
	err := r.db.WithContext(ctx).Model(&TransferJob{}).
		Where("(status = ? AND (NOT EXISTS (SELECT 1 FROM job_queue q WHERE q.id = transfer_jobs.id) OR EXISTS (SELECT 1 FROM job_queue q WHERE q.id = transfer_jobs.id AND q.status IN ?))) OR (status IN ? AND task_run_id IN (SELECT id FROM task_runs WHERE status IN ?))",
			JobStatusQueued, []jobqueue.Status{jobqueue.StatusSucceeded, jobqueue.StatusFailed, jobqueue.StatusCancelled}, terminal,
			[]taskcenter.Status{taskcenter.StatusQueued, taskcenter.StatusRunning, taskcenter.StatusCanceling}).
		Order("created_at ASC, id ASC").Limit(100).Pluck("id", &ids).Error
	if err != nil {
		return nil, err
	}
	var changed []*TransferJob
	for _, id := range ids {
		job, err := r.GetByID(ctx, id)
		if err != nil {
			return changed, err
		}
		if job.Status == JobStatusQueued {
			updated, err := r.UpdateIfStatus(ctx, id, []JobStatus{JobStatusQueued}, map[string]interface{}{"status": JobStatusQueued})
			if err != nil {
				return changed, err
			}
			if !updated {
				continue
			}
			job, err = r.GetByID(ctx, id)
			if err != nil {
				return changed, err
			}
		}
		changed = append(changed, job)
	}
	return changed, nil
}

func (r *repository) Delete(ctx context.Context, id uuid.UUID) error {
	return taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		result := tx.Delete(&TransferJob{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrJobNotFound
		}
		// Removing a transfer artifact/job does not erase its historical activity.
		// Whole work families expire through operation-record retention.
		return nil
	})
}

func (r *repository) publish(job *TransferJob) {
	if r.events == nil || job == nil {
		return
	}
	r.events.Publish(job.Actor, "activity.updated", map[string]interface{}{"transfer_job_id": job.ID, "status": job.Status})
}
