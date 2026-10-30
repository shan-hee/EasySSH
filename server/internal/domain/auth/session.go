package auth

import (
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Session 所有者登录会话
type Session struct {
	TokenHash     string     `gorm:"size:64;not null;uniqueIndex" json:"-"`
	CSRFHash      string     `gorm:"size:64;not null" json:"-"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
	ID            uuid.UUID  `gorm:"type:char(36);primary_key" json:"id"`
	OwnerID       uuid.UUID  `gorm:"type:char(36);not null;index:idx_sessions_owner_expires,priority:1" json:"owner_id"`
	DeviceType    string     `gorm:"size:100" json:"device_type"`                                                      // 设备类型: desktop, mobile, tablet
	DeviceName    string     `gorm:"size:200" json:"device_name"`                                                      // 设备名称/浏览器
	IPAddress     string     `gorm:"size:45" json:"ip_address"`                                                        // IPv4/IPv6
	Location      string     `gorm:"size:200" json:"location"`                                                         // 地理位置
	UserAgent     string     `gorm:"type:text" json:"user_agent"`                                                      // 完整 User-Agent
	LastActivity  time.Time  `gorm:"not null" json:"last_activity"`                                                    // 最近通过认证的 HTTP 请求时间；不代表键鼠输入
	ExpiresAt     time.Time  `gorm:"not null;index:idx_sessions_owner_expires,priority:2,sort:desc" json:"expires_at"` // 空闲过期时间；有效 HTTP 请求会续期
	RememberLogin bool       `gorm:"not null;default:false" json:"remember_login"`                                     // 是否持久保存所有者会话 Cookie
	CreatedAt     time.Time  `json:"created_at"`

	// 登录检测相关字段
	DeviceFingerprint string `gorm:"size:64" json:"device_fingerprint"`    // 设备指纹
	IsNewDevice       bool   `gorm:"default:false" json:"is_new_device"`   // 是否为新设备
	IsNewLocation     bool   `gorm:"default:false" json:"is_new_location"` // 是否为新位置
}

// TableName 指定表名
func (Session) TableName() string {
	return "owner_sessions"
}

// BeforeCreate GORM 钩子
func (s *Session) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.LastActivity.IsZero() {
		s.LastActivity = time.Now()
	}
	return nil
}

func (s Session) Public() protocol.OwnerSession {
	return protocol.OwnerSession{
		RevokedAt:         s.RevokedAt,
		ID:                s.ID,
		OwnerID:           s.OwnerID,
		DeviceType:        s.DeviceType,
		DeviceName:        s.DeviceName,
		IPAddress:         s.IPAddress,
		Location:          s.Location,
		UserAgent:         s.UserAgent,
		LastActivity:      s.LastActivity,
		ExpiresAt:         s.ExpiresAt,
		RememberLogin:     s.RememberLogin,
		CreatedAt:         s.CreatedAt,
		DeviceFingerprint: s.DeviceFingerprint,
		IsNewDevice:       s.IsNewDevice,
		IsNewLocation:     s.IsNewLocation,
	}
}
