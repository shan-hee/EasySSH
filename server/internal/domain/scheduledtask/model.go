package scheduledtask

import (
	"time"

	"github.com/easyssh/shared/protocol"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ScheduledTask 定时任务模型
type ScheduledTask struct {
	ID             uuid.UUID      `gorm:"type:char(36);primary_key" json:"id"`
	OwnerID        uuid.UUID      `gorm:"type:char(36);not null;index" json:"owner_id"`
	TaskName       string         `gorm:"type:varchar(100);not null" json:"task_name"`
	TaskType       string         `gorm:"type:varchar(40);not null" json:"task_type"` // command/script/sftp_upload/sftp_download
	ScriptID       *uuid.UUID     `gorm:"type:char(36)" json:"script_id,omitempty"`
	Command        string         `gorm:"type:text" json:"command,omitempty"`
	PayloadJSON    string         `gorm:"type:text" json:"payload_json,omitempty"`
	ServerIDs      []string       `gorm:"type:text;serializer:json" json:"server_ids"`
	CronExpression string         `gorm:"type:varchar(100);not null" json:"cron_expression"`
	Timezone       string         `gorm:"type:varchar(50);default:'UTC'" json:"timezone"`
	Enabled        bool           `gorm:"not null" json:"enabled"`
	LastRunAt      *time.Time     `json:"last_run_at,omitempty"`
	NextRunAt      *time.Time     `json:"next_run_at,omitempty"`
	RunCount       int            `gorm:"default:0" json:"run_count"`
	FailureCount   int            `gorm:"default:0" json:"failure_count"`
	LastStatus     string         `gorm:"type:varchar(20)" json:"last_status,omitempty"` // success/failed/canceled
	Description    string         `gorm:"type:text" json:"description"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

// BeforeCreate GORM钩子：创建前生成UUID
func (st *ScheduledTask) BeforeCreate(tx *gorm.DB) error {
	if st.ID == uuid.Nil {
		st.ID = uuid.New()
	}
	return nil
}

// TableName 指定表名
func (ScheduledTask) TableName() string {
	return "scheduled_tasks"
}

// Public exposes the generated wire contract rather than the persistence model.
func (task ScheduledTask) Public() protocol.ScheduledTask {
	servers := task.ServerIDs
	if servers == nil {
		servers = []string{}
	}
	return protocol.ScheduledTask{
		ID: task.ID, OwnerID: task.OwnerID, TaskName: task.TaskName, TaskType: protocol.ScheduledTaskType(task.TaskType),
		ScriptID: task.ScriptID, Command: task.Command, PayloadJSON: task.PayloadJSON, ServerIDs: servers,
		CronExpression: task.CronExpression, Timezone: task.Timezone, Enabled: task.Enabled,
		LastRunAt: task.LastRunAt, NextRunAt: task.NextRunAt, RunCount: task.RunCount, FailureCount: task.FailureCount,
		LastStatus: task.LastStatus, Description: task.Description, CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt,
	}
}
