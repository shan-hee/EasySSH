package auth

import (
	"time"

	"github.com/google/uuid"
)

// TOTPReplay 记录已经成功用于登录的 TOTP 时间步。
// user_id + counter 的复合主键使消费操作在 SQLite、PostgreSQL 和 MySQL 上保持原子性。
type TOTPReplay struct {
	UserID  uuid.UUID `gorm:"type:char(36);primaryKey" json:"-"`
	Counter int64     `gorm:"primaryKey" json:"-"`
	UsedAt  time.Time `gorm:"not null;autoCreateTime" json:"-"`
}

func (TOTPReplay) TableName() string {
	return "totp_replays"
}
