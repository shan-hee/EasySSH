package batchtask

import (
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BatchTask 批量任务模型
type BatchTask struct {
	Actor         protocol.Actor    `gorm:"embedded;embeddedPrefix:actor_" json:"actor"`
	ScriptVersion string            `gorm:"size:64" json:"script_version,omitempty"`
	Parameters    map[string]string `gorm:"serializer:json;type:text" json:"parameters"`
	ID            uuid.UUID         `gorm:"type:char(36);primary_key" json:"id"`
	TaskName      string            `gorm:"type:varchar(100);not null" json:"task_name"`
	TaskType      string            `gorm:"type:varchar(20);not null" json:"task_type"` // command/script
	Content       string            `gorm:"type:text" json:"content"`                   // 命令内容或文件路径
	ScriptID      *uuid.UUID        `gorm:"type:char(36)" json:"script_id,omitempty"`   // 关联的脚本ID
	ServerIDs     []string          `gorm:"type:text;serializer:json;not null" json:"server_ids"`
	ExecutionMode string            `gorm:"type:varchar(20);default:'parallel'" json:"execution_mode"` // parallel/sequential
	Status        string            `gorm:"type:varchar(20);default:'pending'" json:"status"`          // pending/queued/running/completed/failed
	SuccessCount  int               `gorm:"default:0" json:"success_count"`
	FailedCount   int               `gorm:"default:0" json:"failed_count"`
	StartedAt     *time.Time        `json:"started_at,omitempty"`
	CompletedAt   *time.Time        `json:"completed_at,omitempty"`
	Duration      int               `json:"duration,omitempty"` // 执行耗时（秒）
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`
	DeletedAt     gorm.DeletedAt    `gorm:"index" json:"-"`
}

// TableName 指定表名
func (BatchTask) TableName() string {
	return "batch_tasks"
}

// BeforeCreate GORM 钩子：创建前自动生成 UUID
func (b *BatchTask) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return nil
}

func (b BatchTask) Public() protocol.BatchTask {
	parameters := b.Parameters
	if parameters == nil {
		parameters = map[string]string{}
	}
	return protocol.BatchTask{ID: b.ID, Actor: b.Actor, TaskName: b.TaskName, TaskType: protocol.BatchTaskType(b.TaskType),
		Content: b.Content, ScriptID: b.ScriptID, ScriptVersion: b.ScriptVersion, Parameters: parameters,
		ServerIDs: b.ServerIDs, ExecutionMode: protocol.BatchTaskExecutionMode(b.ExecutionMode), Status: protocol.BatchTaskStatus(b.Status),
		SuccessCount: b.SuccessCount, FailedCount: b.FailedCount, Duration: b.Duration,
		StartedAt: b.StartedAt, CompletedAt: b.CompletedAt, CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt}
}
