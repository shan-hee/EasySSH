package jobqueue

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/easyssh/server/internal/domain/taskcenter"
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
	Reject(context.Context, uuid.UUID, string, string) (bool, error)
	CancelBySource(ctx context.Context, sourceType, sourceID string) ([]uuid.UUID, error)
	CountQueued(ctx context.Context) (int64, error)
	RecoverExpiredLeases(ctx context.Context, now time.Time) (int64, error)
	CleanupTerminalBefore(ctx context.Context, before time.Time) (int64, error)
}

func (r *repository) CountQueued(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&Job{}).Where("status = ?", StatusQueued).Count(&count).Error
	return count, err
}

type repository struct {
	bodies  taskcenter.Bodies
	events  *realtime.Hub
	db      *gorm.DB
	dialect string
}

func NewRepository(db *gorm.DB, events *realtime.Hub, bodies taskcenter.Bodies) Repository {
	return &repository{db: db, bodies: bodies, dialect: db.Dialector.Name(), events: events}
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
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
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

// terminalTransition holds the queue row while applying its source projection.
// Losing either write rolls back both, so the lease remains recoverable.
func (r *repository) terminalTransition(ctx context.Context, id uuid.UUID, workerID string, statuses []Status, update func(*Job) map[string]interface{}) (bool, error) {
	changed := false
	var settled *taskcenter.TaskRun
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		var job Job
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND status IN ? AND claimed_by = ?", id, statuses, workerID).First(&job).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		updates := update(&job)
		result := tx.Model(&Job{}).Where("id = ? AND status IN ? AND claimed_by = ?", id, statuses, workerID).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		status := updates["status"].(Status)
		if status == StatusFailed || status == StatusSucceeded || status == StatusCancelled {
			message, _ := updates["last_error"].(string)
			finished := updates["finished_at"].(*time.Time)
			if settled, err = settleUnstartedExecution(tx, r.bodies, &job, status, message, *finished); err != nil {
				return err
			}
		}
		changed = true
		return nil
	})
	if err != nil {
		return false, err
	}
	taskcenter.PublishCommittedUpdate(r.events, settled)
	return changed, nil
}

func (r *repository) Complete(ctx context.Context, id uuid.UUID, workerID string) (bool, error) {
	return r.terminalTransition(ctx, id, workerID, []Status{StatusClaimed, StatusRunning}, func(*Job) map[string]interface{} {
		now := time.Now().UTC()
		return map[string]interface{}{"status": StatusSucceeded, "finished_at": &now, "claimed_by": "", "claimed_at": nil, "heartbeat_at": nil, "lease_expires_at": nil}
	})
}
func (r *repository) Fail(ctx context.Context, id uuid.UUID, workerID, message string, retryAt time.Time) (bool, error) {
	return r.terminalTransition(ctx, id, workerID, []Status{StatusClaimed, StatusRunning}, func(job *Job) map[string]interface{} {
		updates := map[string]interface{}{"last_error": message, "claimed_by": "", "claimed_at": nil, "heartbeat_at": nil, "lease_expires_at": nil}
		if job.Attempt < job.MaxAttempts {
			updates["status"], updates["available_at"], updates["finished_at"] = StatusQueued, retryAt, nil
		} else {
			now := time.Now().UTC()
			updates["status"], updates["finished_at"] = StatusFailed, &now
		}
		return updates
	})
}

func (r *repository) CancelBySource(ctx context.Context, sourceType, sourceID string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0)
	settled := []*taskcenter.TaskRun{}
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		var jobs []Job
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id,kind,source_type,source_id,actor_kind,actor_id,actor_session_id,actor_grant_id,max_attempts").
			Where("source_type = ? AND source_id = ? AND status IN ?", sourceType, sourceID, []Status{StatusQueued, StatusClaimed, StatusRunning}).Find(&jobs).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		for i := range jobs {
			result := tx.Model(&Job{}).Where("id = ? AND status IN ?", jobs[i].ID, []Status{StatusQueued, StatusClaimed, StatusRunning}).Updates(map[string]interface{}{
				"status": StatusCancelled, "finished_at": &now, "last_error": "cancelled", "claimed_by": "", "claimed_at": nil, "heartbeat_at": nil, "lease_expires_at": nil,
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				continue
			}
			run, err := settleUnstartedExecution(tx, r.bodies, &jobs[i], StatusCancelled, "dispatch cancelled before command execution", now)
			if err != nil {
				return err
			}
			if run != nil {
				settled = append(settled, run)
			}
			ids = append(ids, jobs[i].ID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, run := range settled {
		taskcenter.PublishCommittedUpdate(r.events, run)
	}
	return ids, nil
}

func (r *repository) RecoverExpiredLeases(ctx context.Context, now time.Time) (int64, error) {
	var jobs []Job
	// A maintenance pass is bounded and never loads executable payloads. More
	// expired leases remain eligible for the next pass; none are replayed here.
	if err := r.db.WithContext(ctx).
		Select("id", "kind", "source_type", "source_id", "actor_kind", "actor_id", "actor_session_id", "actor_grant_id", "attempt", "max_attempts").
		Where("status IN ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?", []Status{StatusClaimed, StatusRunning}, now).
		Order("lease_expires_at ASC").Order("id ASC").Limit(100).
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
		var affected int64
		var settled *taskcenter.TaskRun
		err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
			result := tx.Model(&Job{}).Where("id = ? AND status IN ? AND lease_expires_at <= ?", jobs[i].ID, []Status{StatusClaimed, StatusRunning}, now).Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			affected = result.RowsAffected
			if affected > 0 && updates["status"] == StatusFailed {
				var err error
				settled, err = settleUnstartedExecution(tx, r.bodies, &jobs[i], StatusFailed, "worker lease expired before command execution", now)
				return err
			}
			return nil
		})
		if err != nil {
			return recovered, err
		}
		taskcenter.PublishCommittedUpdate(r.events, settled)
		recovered += affected
	}
	return recovered, nil
}

func (r *repository) CleanupTerminalBefore(ctx context.Context, before time.Time) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("status IN ? AND finished_at IS NOT NULL AND finished_at < ?", []Status{StatusSucceeded, StatusFailed, StatusCancelled}, before).
		Delete(&Job{})
	return result.RowsAffected, result.Error
}

func (r *repository) Reject(ctx context.Context, id uuid.UUID, workerID, message string) (bool, error) {
	return r.terminalTransition(ctx, id, workerID, []Status{StatusRunning}, func(*Job) map[string]interface{} {
		now := time.Now().UTC()
		return map[string]interface{}{"status": StatusFailed, "finished_at": &now, "last_error": message, "claimed_by": "", "claimed_at": nil, "heartbeat_at": nil, "lease_expires_at": nil}
	})
}
