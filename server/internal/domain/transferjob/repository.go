package transferjob

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var ErrJobNotFound = errors.New("transfer job not found")

type Repository interface {
	Create(ctx context.Context, job *TransferJob) error
	Update(ctx context.Context, id uuid.UUID, updates map[string]interface{}) error
	AttachScheduledTask(ctx context.Context, id uuid.UUID, scheduledTaskID uuid.UUID) (bool, error)
	UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []JobStatus, updates map[string]interface{}) (bool, error)
	GetByID(ctx context.Context, id uuid.UUID) (*TransferJob, error)
	GetByUserAndID(ctx context.Context, userID, id uuid.UUID) (*TransferJob, error)
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	GetStatistics(ctx context.Context, userID uuid.UUID) (*Statistics, error)
	FindExpired(ctx context.Context, before time.Time, limit int) ([]*TransferJob, error)
	HasActiveArtifactReference(ctx context.Context, artifactPath string, excludeID uuid.UUID) (bool, error)
	MarkInterrupted(ctx context.Context) error
	Delete(ctx context.Context, id uuid.UUID) error
}

type repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

func (r *repository) Create(ctx context.Context, job *TransferJob) error {
	return r.db.WithContext(ctx).Create(job).Error
}

func (r *repository) Update(ctx context.Context, id uuid.UUID, updates map[string]interface{}) error {
	result := r.db.WithContext(ctx).Model(&TransferJob{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := r.db.WithContext(ctx).Model(&TransferJob{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return ErrJobNotFound
		}
	}
	return nil
}

func (r *repository) AttachScheduledTask(ctx context.Context, id uuid.UUID, scheduledTaskID uuid.UUID) (bool, error) {
	result := r.db.WithContext(ctx).
		Model(&TransferJob{}).
		Where("id = ? AND (scheduled_task_id IS NULL OR scheduled_task_id = ?)", id, scheduledTaskID).
		Updates(map[string]interface{}{
			"scheduled_task_id":   &scheduledTaskID,
			"artifact_expires_at": nil,
		})
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected > 0 {
		return true, nil
	}

	job, err := r.GetByID(ctx, id)
	if err != nil {
		return false, err
	}
	if job.ScheduledTaskID != nil && *job.ScheduledTaskID == scheduledTaskID {
		return true, nil
	}
	return false, nil
}

func (r *repository) UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []JobStatus, updates map[string]interface{}) (bool, error) {
	if len(statuses) == 0 {
		return false, nil
	}
	result := r.db.WithContext(ctx).
		Model(&TransferJob{}).
		Where("id = ? AND status IN ?", id, statuses).
		Updates(updates)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
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

func (r *repository) GetByUserAndID(ctx context.Context, userID, id uuid.UUID) (*TransferJob, error) {
	var job TransferJob
	if err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&job).Error; err != nil {
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

	query := r.db.WithContext(ctx).Model(&TransferJob{})
	if req.UserID != uuid.Nil {
		query = query.Where("user_id = ?", req.UserID)
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

func (r *repository) GetStatistics(ctx context.Context, userID uuid.UUID) (*Statistics, error) {
	stats := &Statistics{}
	query := r.db.WithContext(ctx).Model(&TransferJob{})
	if userID != uuid.Nil {
		query = query.Where("user_id = ?", userID)
	}

	if err := query.Count(&stats.Total).Error; err != nil {
		return nil, err
	}

	countStatus := func(status JobStatus, target *int64) error {
		statusQuery := r.db.WithContext(ctx).Model(&TransferJob{}).Where("status = ?", status)
		if userID != uuid.Nil {
			statusQuery = statusQuery.Where("user_id = ?", userID)
		}
		return statusQuery.Count(target).Error
	}
	if err := countStatus(JobStatusQueued, &stats.Queued); err != nil {
		return nil, err
	}
	if err := countStatus(JobStatusRunning, &stats.Running); err != nil {
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
	if err := countStatus(JobStatusExpired, &stats.Expired); err != nil {
		return nil, err
	}

	sumQuery := r.db.WithContext(ctx).Model(&TransferJob{})
	if userID != uuid.Nil {
		sumQuery = sumQuery.Where("user_id = ?", userID)
	}
	var sums struct {
		BytesTotal     int64
		BytesProcessed int64
		StorageBytes   int64
	}
	if err := sumQuery.
		Select("COALESCE(SUM(bytes_total), 0) AS bytes_total, COALESCE(SUM(bytes_processed), 0) AS bytes_processed, COALESCE(SUM(artifact_size), 0) AS storage_bytes").
		Scan(&sums).Error; err != nil {
		return nil, err
	}
	stats.BytesTotal = sums.BytesTotal
	stats.BytesProcessed = sums.BytesProcessed
	stats.StorageBytes = sums.StorageBytes

	return stats, nil
}

func (r *repository) FindExpired(ctx context.Context, before time.Time, limit int) ([]*TransferJob, error) {
	if limit <= 0 {
		limit = 100
	}
	var jobs []*TransferJob
	err := r.db.WithContext(ctx).
		Where("artifact_expires_at IS NOT NULL AND artifact_expires_at < ? AND status IN ?", before, []JobStatus{
			JobStatusCreated,
			JobStatusCompleted,
			JobStatusFailed,
			JobStatusCancelled,
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
		})
	if excludeID != uuid.Nil {
		query = query.Where("id <> ?", excludeID)
	}
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *repository) MarkInterrupted(ctx context.Context) error {
	now := time.Now()
	return r.db.WithContext(ctx).
		Model(&TransferJob{}).
		Where("status IN ?", []JobStatus{JobStatusStaging, JobStatusQueued, JobStatusRunning}).
		Updates(map[string]interface{}{
			"status":        JobStatusFailed,
			"error_message": "interrupted by server restart",
			"finished_at":   &now,
		}).Error
}

func (r *repository) Delete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).Delete(&TransferJob{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrJobNotFound
	}
	return nil
}
