package jobqueue

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrNoJobAvailable = errors.New("no job available")

type Repository interface {
	Create(ctx context.Context, job *Job) error
	Claim(ctx context.Context, workerID string, leaseDuration time.Duration) (*Job, error)
	MarkRunning(ctx context.Context, id uuid.UUID, workerID string) (bool, error)
	Heartbeat(ctx context.Context, id uuid.UUID, workerID string, leaseDuration time.Duration) (bool, error)
	Complete(ctx context.Context, id uuid.UUID, workerID string) (bool, error)
	Fail(ctx context.Context, id uuid.UUID, workerID, message string, retryAt time.Time) (bool, error)
	CancelBySource(ctx context.Context, sourceType, sourceID string) ([]uuid.UUID, error)
	RecoverExpiredLeases(ctx context.Context, now time.Time) (int64, error)
	CleanupTerminalBefore(ctx context.Context, before time.Time) (int64, error)
}

type repository struct {
	db      *gorm.DB
	dialect string
}

func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db, dialect: db.Dialector.Name()}
}

func (r *repository) Create(ctx context.Context, job *Job) error {
	query := r.db.WithContext(ctx)
	if job.DedupeKey == nil {
		return query.Create(job).Error
	}
	result := query.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "dedupe_key"}}, DoNothing: true}).Create(job)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		return nil
	}
	return query.Where("dedupe_key = ?", *job.DedupeKey).First(job).Error
}

func (r *repository) Claim(ctx context.Context, workerID string, leaseDuration time.Duration) (*Job, error) {
	if r.dialect == "sqlite" {
		return r.claimSQLite(ctx, workerID, leaseDuration)
	}
	return r.claimWithRowLock(ctx, workerID, leaseDuration)
}

func (r *repository) claimSQLite(ctx context.Context, workerID string, leaseDuration time.Duration) (*Job, error) {
	for attempt := 0; attempt < 5; attempt++ {
		now := time.Now()
		var candidate Job
		err := r.db.WithContext(ctx).
			Where("status = ? AND available_at <= ? AND attempt < max_attempts", StatusQueued, now).
			Order("priority DESC, available_at ASC, created_at ASC").
			First(&candidate).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNoJobAvailable
		}
		if err != nil {
			return nil, err
		}

		leaseExpiresAt := now.Add(leaseDuration)
		result := r.db.WithContext(ctx).Model(&Job{}).
			Where("id = ? AND status = ? AND available_at <= ? AND attempt < max_attempts", candidate.ID, StatusQueued, now).
			Updates(map[string]interface{}{
				"status":           StatusClaimed,
				"claimed_by":       workerID,
				"claimed_at":       &now,
				"heartbeat_at":     &now,
				"lease_expires_at": &leaseExpiresAt,
				"attempt":          gorm.Expr("attempt + 1"),
				"last_error":       "",
			})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 0 {
			continue
		}
		var claimed Job
		if err := r.db.WithContext(ctx).Where("id = ?", candidate.ID).First(&claimed).Error; err != nil {
			return nil, err
		}
		return &claimed, nil
	}
	return nil, ErrNoJobAvailable
}

func (r *repository) claimWithRowLock(ctx context.Context, workerID string, leaseDuration time.Duration) (*Job, error) {
	var claimed *Job
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		var candidate Job
		err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ? AND available_at <= ? AND attempt < max_attempts", StatusQueued, now).
			Order("priority DESC, available_at ASC, created_at ASC").
			First(&candidate).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNoJobAvailable
		}
		if err != nil {
			return err
		}
		leaseExpiresAt := now.Add(leaseDuration)
		if err := tx.Model(&Job{}).Where("id = ? AND status = ?", candidate.ID, StatusQueued).Updates(map[string]interface{}{
			"status":           StatusClaimed,
			"claimed_by":       workerID,
			"claimed_at":       &now,
			"heartbeat_at":     &now,
			"lease_expires_at": &leaseExpiresAt,
			"attempt":          gorm.Expr("attempt + 1"),
			"last_error":       "",
		}).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", candidate.ID).First(&candidate).Error; err != nil {
			return err
		}
		claimed = &candidate
		return nil
	})
	return claimed, err
}

func (r *repository) MarkRunning(ctx context.Context, id uuid.UUID, workerID string) (bool, error) {
	result := r.db.WithContext(ctx).Model(&Job{}).
		Where("id = ? AND status = ? AND claimed_by = ?", id, StatusClaimed, workerID).
		Update("status", StatusRunning)
	return result.RowsAffected > 0, result.Error
}

func (r *repository) Heartbeat(ctx context.Context, id uuid.UUID, workerID string, leaseDuration time.Duration) (bool, error) {
	now := time.Now()
	leaseExpiresAt := now.Add(leaseDuration)
	result := r.db.WithContext(ctx).Model(&Job{}).
		Where("id = ? AND status IN ? AND claimed_by = ?", id, []Status{StatusClaimed, StatusRunning}, workerID).
		Updates(map[string]interface{}{"heartbeat_at": &now, "lease_expires_at": &leaseExpiresAt})
	return result.RowsAffected > 0, result.Error
}

func (r *repository) Complete(ctx context.Context, id uuid.UUID, workerID string) (bool, error) {
	now := time.Now()
	result := r.db.WithContext(ctx).Model(&Job{}).
		Where("id = ? AND status IN ? AND claimed_by = ?", id, []Status{StatusClaimed, StatusRunning}, workerID).
		Updates(map[string]interface{}{
			"status": StatusSucceeded, "finished_at": &now,
			"claimed_by": "", "claimed_at": nil, "heartbeat_at": nil, "lease_expires_at": nil,
		})
	return result.RowsAffected > 0, result.Error
}

func (r *repository) Fail(ctx context.Context, id uuid.UUID, workerID, message string, retryAt time.Time) (bool, error) {
	var job Job
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&job).Error; err != nil {
		return false, err
	}
	updates := map[string]interface{}{
		"last_error": message, "claimed_by": "", "claimed_at": nil, "heartbeat_at": nil, "lease_expires_at": nil,
	}
	if job.Attempt < job.MaxAttempts {
		updates["status"] = StatusQueued
		updates["available_at"] = retryAt
		updates["finished_at"] = nil
	} else {
		now := time.Now()
		updates["status"] = StatusFailed
		updates["finished_at"] = &now
	}
	result := r.db.WithContext(ctx).Model(&Job{}).
		Where("id = ? AND status IN ? AND claimed_by = ?", id, []Status{StatusClaimed, StatusRunning}, workerID).
		Updates(updates)
	return result.RowsAffected > 0, result.Error
}

func (r *repository) CancelBySource(ctx context.Context, sourceType, sourceID string) ([]uuid.UUID, error) {
	var jobs []Job
	if err := r.db.WithContext(ctx).
		Select("id").
		Where("source_type = ? AND source_id = ? AND status IN ?", sourceType, sourceID, []Status{StatusQueued, StatusClaimed, StatusRunning}).
		Find(&jobs).Error; err != nil {
		return nil, err
	}
	if len(jobs) == 0 {
		return nil, nil
	}
	ids := make([]uuid.UUID, 0, len(jobs))
	for i := range jobs {
		ids = append(ids, jobs[i].ID)
	}
	now := time.Now()
	if err := r.db.WithContext(ctx).Model(&Job{}).
		Where("id IN ? AND status IN ?", ids, []Status{StatusQueued, StatusClaimed, StatusRunning}).
		Updates(map[string]interface{}{
			"status": StatusCancelled, "finished_at": &now, "last_error": "cancelled",
			"claimed_by": "", "claimed_at": nil, "heartbeat_at": nil, "lease_expires_at": nil,
		}).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func (r *repository) RecoverExpiredLeases(ctx context.Context, now time.Time) (int64, error) {
	var jobs []Job
	if err := r.db.WithContext(ctx).
		Where("status IN ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?", []Status{StatusClaimed, StatusRunning}, now).
		Find(&jobs).Error; err != nil {
		return 0, err
	}
	var recovered int64
	for i := range jobs {
		updates := map[string]interface{}{
			"last_error": "worker lease expired", "claimed_by": "", "claimed_at": nil, "heartbeat_at": nil, "lease_expires_at": nil,
		}
		if jobs[i].Attempt < jobs[i].MaxAttempts {
			updates["status"] = StatusQueued
			updates["available_at"] = now
			updates["finished_at"] = nil
		} else {
			updates["status"] = StatusFailed
			updates["finished_at"] = &now
		}
		result := r.db.WithContext(ctx).Model(&Job{}).
			Where("id = ? AND status IN ? AND lease_expires_at <= ?", jobs[i].ID, []Status{StatusClaimed, StatusRunning}, now).
			Updates(updates)
		if result.Error != nil {
			return recovered, result.Error
		}
		recovered += result.RowsAffected
	}
	return recovered, nil
}

func (r *repository) CleanupTerminalBefore(ctx context.Context, before time.Time) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("status IN ? AND finished_at IS NOT NULL AND finished_at < ?", []Status{StatusSucceeded, StatusFailed, StatusCancelled}, before).
		Delete(&Job{})
	return result.RowsAffected, result.Error
}
