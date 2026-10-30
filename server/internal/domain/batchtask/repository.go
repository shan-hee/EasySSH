package batchtask

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository interface {
	Create(context.Context, *BatchTask) error
	Dispatch(context.Context, *BatchTask) (*taskcenter.TaskRun, error)
	UpdateIfStatus(context.Context, uuid.UUID, []string, map[string]interface{}) (bool, error)
	Delete(context.Context, uuid.UUID) error
	GetByID(context.Context, uuid.UUID) (*BatchTask, error)
	GetVisible(context.Context, uuid.UUID) (*BatchTask, error)
	List(context.Context, *protocol.ListBatchTasksRequest) ([]BatchTask, int64, error)
	GetStatistics(context.Context) (*protocol.BatchTaskStatistics, error)
}
type repository struct {
	db     *gorm.DB
	bodies taskcenter.Bodies
}

func NewRepository(db *gorm.DB, bodies taskcenter.Bodies) Repository {
	return &repository{db: db, bodies: bodies}
}
func (r *repository) Create(ctx context.Context, task *BatchTask) error {
	return r.db.WithContext(ctx).Create(task).Error
}

func (r *repository) UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []string, updates map[string]interface{}) (bool, error) {
	for _, column := range []string{"server_ids", "parameters"} {
		if value, ok := updates[column]; ok {
			encoded, err := json.Marshal(value)
			if err != nil {
				return false, err
			}
			updates[column] = string(encoded)
		}
	}
	result := r.db.WithContext(ctx).Model(&BatchTask{}).Where("id = ? AND status IN ?", id, statuses).Updates(updates)
	return result.RowsAffected > 0, result.Error
}
func (r *repository) Delete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).Where("id = ? AND status NOT IN ?", id, []string{"queued", "running"}).Delete(&BatchTask{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrInvalidBatchTaskData
	}
	return nil
}
func (r *repository) GetByID(ctx context.Context, id uuid.UUID) (*BatchTask, error) {
	return get(r.db.WithContext(ctx), id)
}
func (r *repository) GetVisible(ctx context.Context, id uuid.UUID) (*BatchTask, error) {
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	return get(query, id)
}
func get(query *gorm.DB, id uuid.UUID) (*BatchTask, error) {
	var task BatchTask
	err := query.First(&task, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrBatchTaskNotFound
	}
	return &task, err
}
func (r *repository) List(ctx context.Context, req *protocol.ListBatchTasksRequest) ([]BatchTask, int64, error) {
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx).Model(&BatchTask{}))
	if err != nil {
		return nil, 0, err
	}
	if req.Status != "" {
		query = query.Where("status = ?", req.Status)
	}
	if req.TaskType != "" {
		query = query.Where("task_type = ?", req.TaskType)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	rows := []BatchTask{}
	err = query.Order("created_at DESC,id DESC").Offset((req.Page - 1) * req.Limit).Limit(req.Limit).Find(&rows).Error
	return rows, count, err
}
func (r *repository) GetStatistics(ctx context.Context) (*protocol.BatchTaskStatistics, error) {
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx).Model(&BatchTask{}))
	if err != nil {
		return nil, err
	}
	var groups []struct {
		Status, TaskType string
		Count            int64
	}
	if err := query.Select("status,task_type,count(*) AS count").Group("status,task_type").Scan(&groups).Error; err != nil {
		return nil, err
	}
	stats := &protocol.BatchTaskStatistics{ByType: map[string]int{}}
	for _, group := range groups {
		stats.TotalTasks += group.Count
		stats.ByType[group.TaskType] += int(group.Count)
		switch group.Status {
		case "pending":
			stats.PendingTasks += group.Count
		case "queued":
			stats.QueuedTasks += group.Count
		case "running":
			stats.RunningTasks += group.Count
		case "completed":
			stats.CompletedTasks += group.Count
		case "failed":
			stats.FailedTasks += group.Count
		case "cancelled":
			stats.CancelledTasks += group.Count
		case "unknown":
			stats.UnknownTasks += group.Count
		}
	}
	return stats, nil
}
