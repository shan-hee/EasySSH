package script

import (
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/scriptutil"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Script 脚本模型
type Script struct {
	Version     string         `gorm:"type:char(64);not null" json:"version"`
	ID          uuid.UUID      `gorm:"type:char(36);primary_key" json:"id"`
	Name        string         `gorm:"type:varchar(100);not null" json:"name"`
	Description string         `gorm:"type:text" json:"description"`
	Content     string         `gorm:"type:text;not null" json:"content"`
	Language    string         `gorm:"type:varchar(20);default:'bash'" json:"language"`
	Tags        []string       `gorm:"type:text;serializer:json" json:"tags"`
	Executions  int            `gorm:"default:0" json:"executions"`
	Author      string         `gorm:"type:varchar(50)" json:"author"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (Script) TableName() string {
	return "scripts"
}

// BeforeCreate GORM 钩子：创建前自动生成 UUID
func (s *Script) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.Language == "" {
		s.Language = "bash"
	}
	s.Version = scriptutil.Version(s.Language, s.Content)
	return nil
}

// Struct saves include source and its derived version in the same statement.
// Map updates are controlled by Repository.Update and explicitly set version.
func (s *Script) BeforeSave(tx *gorm.DB) error {
	if _, full := tx.Statement.Dest.(*Script); full {
		if s.Language == "" {
			s.Language = "bash"
		}
		s.Version = scriptutil.Version(s.Language, s.Content)
	}
	return nil
}

// CreateScriptRequest 创建脚本请求
type CreateScriptRequest struct {
	Name        string   `json:"name" binding:"required"`
	Description string   `json:"description"`
	Content     string   `json:"content" binding:"required"`
	Language    string   `json:"language"`
	Tags        []string `json:"tags"`
}

// UpdateScriptRequest 更新脚本请求
type UpdateScriptRequest struct {
	Name        *string  `json:"name"`
	Description *string  `json:"description"`
	Content     *string  `json:"content"`
	Language    *string  `json:"language"`
	Tags        []string `json:"tags"`
}

// ListScriptsRequest 脚本列表查询请求
type ListScriptsRequest struct {
	Page      int      `form:"page" json:"page"`
	Limit     int      `form:"limit" json:"limit"`
	Search    string   `form:"search" json:"search"`     // 搜索关键词
	Tags      []string `form:"tags" json:"tags"`         // 标签筛选
	Language  string   `form:"language" json:"language"` // 语言筛选
	SkipCount bool     `form:"-" json:"-"`               // 跳过统计查询(用于补全场景)
}

// ListScriptsResponse 脚本列表响应
type ListScriptsResponse = protocol.ScriptListResponse

// ExecutionInput is snapshotted into a queued run and revalidated on execution.
type ExecutionInput struct {
	ScriptID   *uuid.UUID        `json:"script_id,omitempty"`
	Version    string            `json:"script_version"`
	Parameters map[string]string `json:"parameters"`
}

func (s Script) Public() protocol.Script {
	return protocol.Script{
		ID: s.ID, Name: s.Name, Description: s.Description, Content: s.Content,
		Language: s.Language, Tags: s.Tags, Version: s.Version, Executions: s.Executions,
		Author: s.Author, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
	}
}
