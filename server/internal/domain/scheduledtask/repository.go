package scheduledtask

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository 定时任务数据访问接口
type Repository interface {
	Create(context.Context, *ScheduledTask) error
	Update(context.Context, uuid.UUID, map[string]interface{}) error
	UpdateRuntime(context.Context, uuid.UUID, map[string]interface{}) error
	Delete(context.Context, uuid.UUID) error
	GetByID(id uuid.UUID) (*ScheduledTask, error)
	CheckStage(context.Context, uuid.UUID, string, uuid.UUID, bool, string) error
	List(ctx context.Context, req *protocol.ListScheduledTasksRequest) ([]ScheduledTask, int64, error)
	GetStatistics(ctx context.Context) (*protocol.ScheduledTaskStatistics, error)
	GetEnabledTasks(context.Context, uuid.UUID, int) ([]ScheduledTask, error)
}

type repository struct {
	db *gorm.DB
}

// NewRepository 创建定时任务仓储实例
func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

// Create 创建定时任务
func (r *repository) Create(ctx context.Context, task *ScheduledTask) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		return recordConfiguration(tx, "scheduled_task_create", *task, []string{"created"}, nil)
	})
}

// Update 更新定时任务
func (r *repository) Update(ctx context.Context, id uuid.UUID, updates map[string]interface{}) error {
	if ids, ok := updates["server_ids"].([]string); ok {
		encoded, err := json.Marshal(ids)
		if err != nil {
			return err
		}
		updates["server_ids"] = string(encoded)
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var before ScheduledTask
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&before, "id=?", id).Error; err != nil {
			return err
		}
		if err := tx.Model(&ScheduledTask{}).Where("id=?", id).Updates(updates).Error; err != nil {
			return err
		}
		var after ScheduledTask
		if err := tx.First(&after, "id=?", id).Error; err != nil {
			return err
		}
		fields := configurationFields(before, after)
		if len(fields) == 0 {
			return nil
		}
		action := "scheduled_task_update"
		if len(fields) == 1 && fields[0] == "enabled" {
			action = "scheduled_task_toggle"
		}
		return recordConfiguration(tx, action, after, fields, &before)
	})
}

// Runtime timestamps and counters are observations, not configuration changes.
// Keep their writes independent of an owner request and never accept executable
// fields through this scheduler-only path.
func (r *repository) UpdateRuntime(ctx context.Context, id uuid.UUID, updates map[string]interface{}) error {
	for field := range updates {
		switch field {
		case "last_run_at", "next_run_at", "run_count", "failure_count", "last_status":
		default:
			return access.ErrForbidden
		}
	}
	return r.db.WithContext(ctx).Model(&ScheduledTask{}).Where("id=?", id).Updates(updates).Error
}

// Delete removes the definition; later execution stages reject its absence.
func (r *repository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row ScheduledTask
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id=?", id).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Delete(&row).Error; err != nil {
			return err
		}
		return recordConfiguration(tx, "scheduled_task_delete", row, []string{"deleted"}, nil)
	})
}

// GetByID 根据ID获取定时任务
func (r *repository) GetByID(id uuid.UUID) (*ScheduledTask, error) {
	var task ScheduledTask
	err := r.db.Where("id = ?", id).First(&task).Error
	if err != nil {
		return nil, err
	}
	return &task, nil
}

// List 获取定时任务列表
func (r *repository) List(ctx context.Context, req *protocol.ListScheduledTasksRequest) ([]ScheduledTask, int64, error) {
	var tasks []ScheduledTask
	var total int64

	query := r.db.WithContext(ctx).Model(&ScheduledTask{})

	// 筛选条件
	if req.Enabled != nil {
		query = query.Where("enabled = ?", *req.Enabled)
	}

	if req.TaskType != "" {
		query = query.Where("task_type = ?", req.TaskType)
	}

	// 计算总数
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 分页
	offset := (req.Page - 1) * req.Limit
	if err := query.Order("created_at DESC").
		Offset(offset).
		Limit(req.Limit).
		Find(&tasks).Error; err != nil {
		return nil, 0, err
	}

	return tasks, total, nil
}

// GetStatistics 获取定时任务统计信息
func (r *repository) GetStatistics(ctx context.Context) (*protocol.ScheduledTaskStatistics, error) {
	var groups []struct {
		Enabled         bool
		TaskType        string
		Count, RunCount int64
	}
	if err := r.db.WithContext(ctx).Model(&ScheduledTask{}).Select("enabled, task_type, count(*) AS count, COALESCE(SUM(run_count),0) AS run_count").Group("enabled, task_type").Scan(&groups).Error; err != nil {
		return nil, err
	}
	stats := &protocol.ScheduledTaskStatistics{ByType: map[string]int{}}
	for _, row := range groups {
		stats.TotalTasks += row.Count
		stats.TotalRuns += row.RunCount
		stats.ByType[row.TaskType] += int(row.Count)
		if row.Enabled {
			stats.EnabledTasks += row.Count
		} else {
			stats.DisabledTasks += row.Count
		}
	}
	return stats, nil
}

// GetEnabledTasks reads only scheduling metadata in bounded UUID order.
func (r *repository) GetEnabledTasks(ctx context.Context, after uuid.UUID, limit int) ([]ScheduledTask, error) {
	if limit < 1 || limit > 100 {
		return nil, errors.New("invalid schedule page size")
	}
	query := r.db.WithContext(ctx).Model(&ScheduledTask{}).Where("enabled=?", true)
	if after != uuid.Nil {
		query = query.Where("id>?", after)
	}
	tasks := []ScheduledTask{}
	err := query.Select("id", "task_name", "cron_expression", "timezone", "enabled").Order("id ASC").Limit(limit).Find(&tasks).Error
	return tasks, err
}
