package permission

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Module string

const (
	ModuleServer   Module = "server"
	ModuleFile     Module = "file"
	ModuleTerminal Module = "terminal"
	ModuleAudit    Module = "audit"
	ModuleSystem   Module = "system"
)

func (m Module) IsValid() bool {
	switch m {
	case ModuleServer, ModuleFile, ModuleTerminal, ModuleAudit, ModuleSystem:
		return true
	default:
		return false
	}
}

type Permission struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Module      Module `json:"module"`
	Resource    string `json:"resource"`
}

type Role struct {
	ID          uuid.UUID      `gorm:"type:char(36);primaryKey" json:"id"`
	Key         string         `gorm:"size:64;not null;uniqueIndex" json:"key"`
	Name        string         `gorm:"size:100;not null" json:"name"`
	Description string         `gorm:"type:text" json:"description"`
	ParentKey   *string        `gorm:"size:64;index" json:"parent_key,omitempty"`
	System      bool           `gorm:"not null;default:false" json:"system"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Role) TableName() string {
	return "roles"
}

func (r *Role) BeforeCreate(*gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

type RoleView struct {
	Role
	PermissionCodes          []string `json:"permission_codes"`
	EffectivePermissionCodes []string `json:"effective_permission_codes"`
}

type ResourceGrant struct {
	ID             string `json:"id"`
	SubjectType    string `json:"subject_type"`
	SubjectID      string `json:"subject_id"`
	PermissionCode string `json:"permission_code"`
	ResourceType   string `json:"resource_type"`
	ResourceID     string `json:"resource_id"`
}

type defaultRole struct {
	Key             string
	Name            string
	Description     string
	PermissionCodes []string
}

func PermissionDefinitions() []Permission {
	return []Permission{
		{Code: "server:manage", Name: "服务器管理", Description: "创建、编辑、删除服务器连接", Module: ModuleServer, Resource: "server/*"},
		{Code: "server:view", Name: "服务器查看", Description: "查看服务器列表和详情", Module: ModuleServer, Resource: "server/*"},
		{Code: "server:connect", Name: "服务器连接", Description: "连接到远程服务器", Module: ModuleServer, Resource: "server/*"},
		{Code: "file:manage", Name: "文件管理", Description: "上传、下载、修改和删除远程文件", Module: ModuleFile, Resource: "server/*"},
		{Code: "file:view", Name: "文件查看", Description: "浏览和读取远程文件", Module: ModuleFile, Resource: "server/*"},
		{Code: "terminal:execute", Name: "终端执行", Description: "在远程服务器执行命令", Module: ModuleTerminal, Resource: "server/*"},
		{Code: "docker:view", Name: "Docker 查看", Description: "查看远程服务器 Docker 资源", Module: ModuleServer, Resource: "server/*"},
		{Code: "docker:manage", Name: "Docker 管理", Description: "管理远程服务器 Docker 容器", Module: ModuleServer, Resource: "server/*"},
		{Code: "audit:view", Name: "审计日志查看", Description: "查看和清理系统审计日志", Module: ModuleAudit, Resource: "audit/*"},
		{Code: "dashboard:view-all", Name: "全局仪表盘", Description: "查看所有用户的聚合统计", Module: ModuleAudit, Resource: "dashboard/*"},
		{Code: "system:settings", Name: "系统设置", Description: "查看和修改系统配置", Module: ModuleSystem, Resource: "system/*"},
		{Code: "backup:manage", Name: "备份恢复", Description: "导出和恢复系统备份", Module: ModuleSystem, Resource: "backup/*"},
		{Code: "user:manage", Name: "用户与角色管理", Description: "管理用户、角色和资源授权", Module: ModuleSystem, Resource: "user/*"},
	}
}

func defaultRoles() []defaultRole {
	return []defaultRole{
		{
			Key:         "admin",
			Name:        "管理员",
			Description: "拥有全部系统管理权限",
			PermissionCodes: []string{
				"server:manage", "server:view", "server:connect", "file:manage", "file:view", "terminal:execute",
				"docker:view", "docker:manage", "audit:view", "dashboard:view-all", "system:settings", "backup:manage", "user:manage",
			},
		},
		{
			Key:         "user",
			Name:        "普通用户",
			Description: "可使用自己的服务器、终端、文件和 Docker 查看功能",
			PermissionCodes: []string{
				"server:view", "server:connect", "file:manage", "file:view", "terminal:execute", "docker:view",
			},
		},
		{
			Key:             "viewer",
			Name:            "只读用户",
			Description:     "仅可查看自己的服务器和远程文件",
			PermissionCodes: []string{"server:view", "file:view"},
		},
	}
}
