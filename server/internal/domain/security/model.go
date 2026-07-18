package security

import (
	"strings"
	"time"

	"gorm.io/gorm"
)

// SecurityConfig 安全配置模型
type SecurityConfig struct {
	ID uint `gorm:"primarykey" json:"id"`

	// 会话管理
	SessionTimeout  int  `gorm:"not null;default:30" json:"session_timeout"`  // 会话超时时间（分钟）
	MaxTabs         int  `gorm:"not null;default:10" json:"max_tabs"`         // 最大标签页数
	InactiveMinutes int  `gorm:"not null;default:15" json:"inactive_minutes"` // 非活动断开提醒��间（分钟）
	RememberLogin   bool `gorm:"not null;default:true" json:"remember_login"` // 是否允许记住登录状态
	Hibernate       bool `gorm:"not null;default:true" json:"hibernate"`      // 是否启用后台标签页休眠

	// 网络安全
	AllowlistIPs string `gorm:"type:text" json:"allowlist_ips"` // IP白名单（换行分隔）
	BlocklistIPs string `gorm:"type:text" json:"blocklist_ips"` // IP黑名单（换行分隔）

	// CORS配置（JSON存储）
	CORSConfig string `gorm:"type:text" json:"cors_config"` // JSON: CORSConfig

	// Web 部署与浏览器安全
	TrustedProxies            string `gorm:"type:text;not null;default:'127.0.0.1'" json:"trusted_proxies"`
	CookieSecureMode          string `gorm:"size:16;not null;default:'auto'" json:"cookie_secure_mode"`
	CookieDomain              string `gorm:"size:255" json:"cookie_domain"`
	CookieSameSite            string `gorm:"size:16;not null;default:'lax'" json:"cookie_same_site"`
	CSRFTrustedOrigins        string `gorm:"type:text" json:"csrf_trusted_origins"`
	ContentSecurityPolicy     string `gorm:"type:text" json:"content_security_policy"`
	PasswordPwnedCheckEnabled bool   `gorm:"not null;default:false" json:"password_pwned_check_enabled"`

	// 速率限制
	LoginLimit int `gorm:"not null;default:5" json:"login_limit"`  // 登录接口速率限制（次/分钟/IP）
	APILimit   int `gorm:"not null;default:100" json:"api_limit"`  // API 接口速率限制（次/分钟/IP）
	TwoFALimit int `gorm:"not null;default:5" json:"two_fa_limit"` // 2FA 验证速率限制（次/分钟/IP）

	// 账户锁定配置
	AccountLockEnabled         bool `gorm:"not null;default:true" json:"account_lock_enabled"`        // 是否启用账户锁定
	MaxIPFailAttempts          int  `gorm:"not null;default:10" json:"max_ip_fail_attempts"`          // IP 最大失败次数
	IPLockDurationMinutes      int  `gorm:"not null;default:30" json:"ip_lock_duration_minutes"`      // IP 锁定时长（分钟）
	MaxAccountFailAttempts     int  `gorm:"not null;default:5" json:"max_account_fail_attempts"`      // 账户最大失败次数
	AccountLockDurationMinutes int  `gorm:"not null;default:60" json:"account_lock_duration_minutes"` // 账户锁定时长（分钟）

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (SecurityConfig) TableName() string {
	return "security_config"
}

// CORSConfig CORS 配置结构
type CORSConfig struct {
	AllowedOrigins []string `json:"allowed_origins"` // 允许的域名列表
}

// DefaultCORSConfig 默认CORS配置
func DefaultCORSConfig() *CORSConfig {
	return &CORSConfig{
		AllowedOrigins: []string{},
	}
}

const DefaultContentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://accounts.google.com https://apis.google.com blob:; " +
	"worker-src 'self' blob:; " +
	"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://accounts.google.com; " +
	"img-src 'self' data: https:; " +
	"font-src 'self' data: https://fonts.gstatic.com; " +
	"connect-src 'self' https://cdn.jsdelivr.net https://api.dicebear.com https://accounts.google.com https://oauth2.googleapis.com; " +
	"frame-src 'self' https://accounts.google.com"

func (c *SecurityConfig) TrustedProxyList() []string {
	if c == nil {
		return []string{"127.0.0.1", "::1"}
	}
	return nonEmptyLines(c.TrustedProxies)
}

func (c *SecurityConfig) CSRFTrustedOriginList() []string {
	if c == nil {
		return nil
	}
	return nonEmptyLines(c.CSRFTrustedOrigins)
}

func (c *SecurityConfig) EffectiveContentSecurityPolicy() string {
	if c == nil || c.ContentSecurityPolicy == "" {
		return DefaultContentSecurityPolicy
	}
	return c.ContentSecurityPolicy
}

func nonEmptyLines(raw string) []string {
	values := make([]string, 0)
	for _, value := range strings.Split(raw, "\n") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

// RateLimitConfig 速率限制配置结构
type RateLimitConfig struct {
	LoginLimit int `json:"login_limit"`  // 登录接口速率限制（次/分钟/IP）
	APILimit   int `json:"api_limit"`    // API 接口速率限制（次/分钟/IP）
	TwoFALimit int `json:"two_fa_limit"` // 2FA 验证速率限制（次/分钟/IP）
}

// AccountLockConfig 账户锁定配置结构
type AccountLockConfig struct {
	Enabled                    bool `json:"enabled"`                       // 是否启用账户锁定
	MaxIPFailAttempts          int  `json:"max_ip_fail_attempts"`          // IP 最大失败次数
	IPLockDurationMinutes      int  `json:"ip_lock_duration_minutes"`      // IP 锁定时长（分钟）
	MaxAccountFailAttempts     int  `json:"max_account_fail_attempts"`     // 账户最大失败次数
	AccountLockDurationMinutes int  `json:"account_lock_duration_minutes"` // 账户锁定时长（分钟）
}

// DefaultAccountLockConfig 默认账户锁定配置
func DefaultAccountLockConfig() *AccountLockConfig {
	return &AccountLockConfig{
		Enabled:                    true,
		MaxIPFailAttempts:          10,
		IPLockDurationMinutes:      30,
		MaxAccountFailAttempts:     5,
		AccountLockDurationMinutes: 60,
	}
}
