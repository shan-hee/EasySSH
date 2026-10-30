package server

import (
	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"gorm.io/gorm/clause"
	"sort"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AuthMethod 认证方式 / 认证策略。
type AuthMethod string

const (
	AuthMethodPassword                 AuthMethod = "password"
	AuthMethodKey                      AuthMethod = "key"
	AuthMethodPasswordKeyboard         AuthMethod = "password_keyboard"
	AuthMethodKeyKeyboard              AuthMethod = "key_keyboard"
	AuthMethodKeyPassword              AuthMethod = "key_password"
	AuthMethodKeyPasswordKeyboard      AuthMethod = "key_password_keyboard"
	AuthMethodPasswordKey              AuthMethod = "password_key"
	AuthMethodPasswordKeyKeyboard      AuthMethod = "password_key_keyboard"
	AuthMethodKeyboardInteractive      AuthMethod = "keyboard_interactive"
	AuthMethodKeyboardInteractiveAlias AuthMethod = "keyboard"
)

// AuthFactor 认证策略中的单个 SSH 认证因子。
type AuthFactor string

const (
	AuthFactorPassword            AuthFactor = "password"
	AuthFactorKey                 AuthFactor = "key"
	AuthFactorKeyboardInteractive AuthFactor = "keyboard_interactive"
)

// ServerStatus 服务器状态
// 只有两种状态：online（上次连接成功）和 offline（从未连接或上次连接失败）
type ServerStatus string

const (
	StatusOnline  ServerStatus = "online"
	StatusOffline ServerStatus = "offline"
)

// Server 服务器模型
type Server struct {
	executionScope     access.Scope
	Auth               ServerAuth   `gorm:"foreignKey:ServerID;references:ID;constraint:OnDelete:CASCADE" json:"-"`
	ConnectionRevision int64        `gorm:"not null;default:1" json:"connection_revision"`
	ID                 uuid.UUID    `gorm:"type:char(36);primary_key" json:"id"`
	Name               string       `gorm:"size:100" json:"name"`
	Host               string       `gorm:"not null;size:255" json:"host"`
	Port               int          `gorm:"not null;default:22;check:port BETWEEN 1 AND 65535" json:"port"`
	Username           string       `gorm:"not null;size:50" json:"username"`
	GroupID            *uuid.UUID   `gorm:"type:char(36);index" json:"group_id"`
	GroupRecord        *ServerGroup `gorm:"foreignKey:GroupID;references:ID;constraint:OnDelete:SET NULL" json:"-"`
	Group              string       `gorm:"-" json:"group"`
	TagRecords         []ServerTag  `gorm:"foreignKey:ServerID;references:ID;constraint:OnDelete:CASCADE" json:"-"`
	Tags               []string     `gorm:"-" json:"tags"`
	Status             ServerStatus `gorm:"type:varchar(20);default:'offline'" json:"status"`
	LastConnected      *time.Time   `json:"last_connected,omitempty"`
	Description        string       `gorm:"type:text" json:"description"`
	OS                 string       `gorm:"size:100" json:"os,omitempty"`
	SortOrder          int          `gorm:"default:0;index" json:"sort_order"` // 用户自定义排序顺序
	// 地理位置信息（通过 IP 自动查询）
	Country     string         `gorm:"size:100" json:"country,omitempty"`
	CountryCode string         `gorm:"size:10" json:"country_code,omitempty"`
	Region      string         `gorm:"size:100" json:"region,omitempty"`
	City        string         `gorm:"size:100" json:"city,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"` // 软删除
}

// TableName 指定表名
func (Server) TableName() string {
	return "servers"
}

func (s *Server) CredentialAAD(column string) []byte {
	return crypto.SecretAAD("server_auth", s.ID.String(), column)
}

// AuthFactors 返回当前认证策略包含的 SSH 认证因子及顺序。
func (m AuthMethod) AuthFactors() ([]AuthFactor, bool) {
	switch m {
	case AuthMethodPassword:
		return []AuthFactor{AuthFactorPassword}, true
	case AuthMethodKey:
		return []AuthFactor{AuthFactorKey}, true
	case AuthMethodPasswordKeyboard:
		return []AuthFactor{AuthFactorPassword, AuthFactorKeyboardInteractive}, true
	case AuthMethodKeyKeyboard:
		return []AuthFactor{AuthFactorKey, AuthFactorKeyboardInteractive}, true
	case AuthMethodKeyPassword:
		return []AuthFactor{AuthFactorKey, AuthFactorPassword}, true
	case AuthMethodKeyPasswordKeyboard:
		return []AuthFactor{AuthFactorKey, AuthFactorPassword, AuthFactorKeyboardInteractive}, true
	case AuthMethodPasswordKey:
		return []AuthFactor{AuthFactorPassword, AuthFactorKey}, true
	case AuthMethodPasswordKeyKeyboard:
		return []AuthFactor{AuthFactorPassword, AuthFactorKey, AuthFactorKeyboardInteractive}, true
	case AuthMethodKeyboardInteractive, AuthMethodKeyboardInteractiveAlias:
		return []AuthFactor{AuthFactorKeyboardInteractive}, true
	default:
		return nil, false
	}
}

func (m AuthMethod) IsValid() bool {
	_, ok := m.AuthFactors()
	return ok
}

func (m AuthMethod) RequiresPassword() bool {
	factors, ok := m.AuthFactors()
	if !ok {
		return false
	}
	for _, factor := range factors {
		if factor == AuthFactorPassword {
			return true
		}
	}
	return false
}

func (m AuthMethod) RequiresPrivateKey() bool {
	factors, ok := m.AuthFactors()
	if !ok {
		return false
	}
	for _, factor := range factors {
		if factor == AuthFactorKey {
			return true
		}
	}
	return false
}

func (m AuthMethod) SupportsKeyboardInteractive() bool {
	factors, ok := m.AuthFactors()
	if !ok {
		return false
	}
	for _, factor := range factors {
		if factor == AuthFactorKeyboardInteractive {
			return true
		}
	}
	return false
}

// BeforeCreate GORM 钩子：创建前生成 UUID
func (s *Server) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	s.Auth.ServerID = s.ID
	return nil
}

func (s *Server) AfterFind(*gorm.DB) error {
	s.Tags = make([]string, 0, len(s.TagRecords))
	for _, tag := range s.TagRecords {
		s.Tags = append(s.Tags, tag.TagName)
	}
	sort.Strings(s.Tags)
	if s.GroupRecord != nil {
		s.Group = s.GroupRecord.Name
	}
	return nil
}

// IsOnline 判断服务器是否在线
func (s *Server) IsOnline() bool {
	return s.Status == StatusOnline
}

// ToPublic 转换为公开信息（不包含密码和私钥）
func (s *Server) ToPublic() protocol.Server {
	status := protocol.ServerStatus(s.Status)
	result := protocol.Server{ID: s.ID, Name: s.Name, Host: s.Host, Port: s.Port, Username: s.Username, Status: &status, OS: s.OS}
	if !s.executionScope.IsOwner() {
		return result
	}
	auth := protocol.ServerAuthMethod(s.Auth.AuthMethod)
	hasPassword := s.Auth.Password != ""
	hasPrivateKey := s.Auth.SSHKey != nil && s.Auth.SSHKey.PrivateKey != ""
	groupID := ""
	if s.GroupID != nil {
		groupID = s.GroupID.String()
	}
	tags := s.Tags
	if tags == nil {
		tags = []string{}
	}
	result.ConnectionRevision, result.AuthMethod = &s.ConnectionRevision, &auth
	result.HasPassword, result.HasPrivateKey = &hasPassword, &hasPrivateKey
	result.SSHKeyID, result.GroupID, result.Group, result.Tags = s.Auth.SSHKeyID, &groupID, &s.Group, &tags
	result.Description, result.SortOrder = &s.Description, &s.SortOrder
	result.CreatedAt, result.UpdatedAt, result.LastConnected = &s.CreatedAt, &s.UpdatedAt, s.LastConnected
	result.Country, result.CountryCode, result.Region, result.City = s.Country, s.CountryCode, s.Region, s.City
	return result
}

// UpdateStatus 更新服务器状态
func (s *Server) UpdateStatus(status ServerStatus) {
	s.Status = status
	if status == StatusOnline {
		now := time.Now()
		s.LastConnected = &now
	}
}

type ServerAuth struct {
	ServerID   uuid.UUID      `gorm:"type:char(36);primaryKey" json:"-"`
	AuthMethod AuthMethod     `gorm:"type:varchar(64);not null" json:"auth_method"`
	Password   string         `gorm:"type:text" json:"-"` // 加密存储，不在 JSON 中返回
	SSHKeyID   *uuid.UUID     `gorm:"index" json:"ssh_key_id"`
	SSHKey     *sshkey.SSHKey `gorm:"foreignKey:SSHKeyID;constraint:OnDelete:RESTRICT,OnUpdate:CASCADE" json:"-"`
}

func (ServerAuth) TableName() string { return "server_auth" }

func (s *Server) SaveAuth(tx *gorm.DB) error {
	s.Auth.ServerID = s.ID
	return tx.Omit("SSHKey").Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "server_id"}}, DoUpdates: clause.AssignmentColumns([]string{"auth_method", "password", "ssh_key_id"})}).Create(&s.Auth).Error
}

func (s *Server) ExecutionScope() access.Scope { return s.executionScope }

// CredentialDigest tracks saved secrets independently of sharing approval.
func (s *Server) CredentialDigest() [32]byte {
	key, phrase := "", ""
	if s.Auth.SSHKey != nil {
		key, phrase = s.Auth.SSHKey.PrivateKey, s.Auth.SSHKey.SavedPassphrase
	}
	return sshutil.CredentialDigest(s.Auth.Password, key, phrase)
}
