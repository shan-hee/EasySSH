package systemconfig

import (
	"time"

	"gorm.io/gorm"
)

// SystemConfig 系统配置模型
type SystemConfig struct {
	ID uint `gorm:"primarykey" json:"id"`

	// 基本信息
	SystemName    string `gorm:"size:100;not null;default:'EasySSH'" json:"system_name"`
	SystemLogo    string `gorm:"type:text" json:"system_logo"`
	SystemFavicon string `gorm:"type:text" json:"system_favicon"`

	// 国际化设置
	DefaultLanguage string `gorm:"size:10;not null;default:'zh-CN'" json:"default_language"`
	DefaultTimezone string `gorm:"size:50;not null;default:'Asia/Shanghai'" json:"default_timezone"`
	DateFormat      string `gorm:"size:50;not null;default:'YYYY-MM-DD HH:mm:ss'" json:"date_format"`

	// 文件传输设置
	DownloadExcludePatterns string `gorm:"type:text" json:"download_exclude_patterns"`
	DefaultDownloadMode     string `gorm:"size:20;not null;default:'fast'" json:"default_download_mode"`
	SkipExcludedOnUpload    bool   `gorm:"not null;default:true" json:"skip_excluded_on_upload"`
	MaxFileUploadSize       int    `gorm:"not null;default:100" json:"max_file_upload_size"` // MB
	TransferStoragePath     string `gorm:"type:text" json:"transfer_storage_path"`
	TransferRetentionDays   int    `gorm:"not null;default:3" json:"transfer_retention_days"`
	TransferMaxStorageGB    int    `gorm:"not null;default:10" json:"transfer_max_storage_gb"`
	TransferMaxConcurrency  int    `gorm:"not null;default:2" json:"transfer_max_concurrency"`
	TransferCleanupEnabled  bool   `gorm:"not null;default:true" json:"transfer_cleanup_enabled"`

	// 注册配置
	AllowRegistration bool   `gorm:"not null;default:false" json:"allow_registration"`
	DefaultRole       string `gorm:"size:64;not null;default:'user'" json:"default_role"`

	// OAuth 配置
	OAuthEnabled       bool   `gorm:"column:oauth_enabled;not null;default:false" json:"oauth_enabled"`
	GoogleClientID     string `gorm:"size:255" json:"google_client_id"`
	GoogleClientSecret string `gorm:"size:255" json:"-"` // 加密存储，不返回给前端

	OAuthAccessTokenMinutes int `gorm:"column:oauth_access_token_minutes;not null;default:15" json:"oauth_access_token_minutes"`
	OAuthRefreshTokenDays   int `gorm:"column:oauth_refresh_token_days;not null;default:30" json:"oauth_refresh_token_days"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (SystemConfig) TableName() string {
	return "system_config"
}

type OAuthTokenConfig struct {
	AccessTokenMinutes int `json:"oauth_access_token_minutes"`
	RefreshTokenDays   int `json:"oauth_refresh_token_days"`
}

func DefaultOAuthTokenConfig() *OAuthTokenConfig {
	return &OAuthTokenConfig{
		AccessTokenMinutes: 15,
		RefreshTokenDays:   30,
	}
}

func (c *SystemConfig) OAuthTokenConfig() *OAuthTokenConfig {
	defaults := DefaultOAuthTokenConfig()
	if c == nil {
		return defaults
	}

	settings := &OAuthTokenConfig{
		AccessTokenMinutes: c.OAuthAccessTokenMinutes,
		RefreshTokenDays:   c.OAuthRefreshTokenDays,
	}

	if settings.AccessTokenMinutes <= 0 {
		settings.AccessTokenMinutes = defaults.AccessTokenMinutes
	}
	if settings.RefreshTokenDays <= 0 {
		settings.RefreshTokenDays = defaults.RefreshTokenDays
	}

	return settings
}

// DefaultDownloadExcludePatterns 默认下载排除规则
func DefaultDownloadExcludePatterns() string {
	return `node_modules
.git
.svn
.hg
.DS_Store
Thumbs.db
*.tmp
*.log
*.swp
*.bak
__pycache__
.pytest_cache
.venv
venv
dist
build
target`
}

// DefaultTransferStoragePath 为空表示使用运行时数据目录下的 transfers 子目录。
func DefaultTransferStoragePath() string {
	return ""
}

func DefaultTransferRetentionDays() int {
	return 3
}

func DefaultTransferMaxStorageGB() int {
	return 10
}

func DefaultTransferMaxConcurrency() int {
	return 2
}

func (c *SystemConfig) ApplyTransferDefaults() {
	if c == nil {
		return
	}
	if c.TransferRetentionDays <= 0 {
		c.TransferRetentionDays = DefaultTransferRetentionDays()
	}
	if c.TransferMaxStorageGB <= 0 {
		c.TransferMaxStorageGB = DefaultTransferMaxStorageGB()
	}
	if c.TransferMaxConcurrency <= 0 {
		c.TransferMaxConcurrency = DefaultTransferMaxConcurrency()
	}
}
