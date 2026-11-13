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
	SkipExcludedOnUpload    bool   `gorm:"not null;default:true" json:"skip_excluded_on_upload"`
	MaxFileUploadSize       int    `gorm:"not null;default:100" json:"max_file_upload_size"` // MB
	TransferStoragePath     string `gorm:"type:text" json:"transfer_storage_path"`
	TransferRetentionDays   int    `gorm:"not null;default:3" json:"transfer_retention_days"`
	TransferMaxStorageGB    int    `gorm:"not null;default:10" json:"transfer_max_storage_gb"`
	TransferMaxConcurrency  int    `gorm:"not null;default:2" json:"transfer_max_concurrency"`
	TransferMaxEntries      int    `gorm:"not null;default:100000" json:"transfer_max_entries"`
	TransferMaxDepth        int    `gorm:"not null;default:128" json:"transfer_max_depth"`
	TransferCleanupEnabled  bool   `gorm:"not null;default:true" json:"transfer_cleanup_enabled"`

	// 连接运行参数（启动时读取，修改后重启生效）
	SFTPMaxIdleTimeSeconds     int `gorm:"not null;default:120" json:"sftp_max_idle_time_seconds"`
	SFTPCleanupIntervalSeconds int `gorm:"not null;default:30" json:"sftp_cleanup_interval_seconds"`
	SFTPMaxLifeTimeMinutes     int `gorm:"not null;default:0" json:"sftp_max_life_time_minutes"`
	SFTPConnTimeoutSeconds     int `gorm:"not null;default:10" json:"sftp_conn_timeout_seconds"`
	SFTPMaxSessionsPerConn     int `gorm:"not null;default:8" json:"sftp_max_sessions_per_conn"`

	// 后台任务队列（运行时动态生效）
	JobQueueMaxConcurrency int `gorm:"not null;default:2" json:"job_queue_max_concurrency"`

	// 数据保留天数，0 表示永久保留；取值见 shared/retention。
	TaskRetentionDays int `gorm:"not null;default:90" json:"task_retention_days"`
	LogRetentionDays  int `gorm:"not null;default:90" json:"log_retention_days"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (SystemConfig) TableName() string {
	return "system_config"
}

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

func DefaultTransferMaxEntries() int { return 100000 }

func DefaultTransferMaxDepth() int { return 128 }

func DefaultJobQueueMaxConcurrency() int {
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
	if c.TransferMaxEntries == 0 {
		c.TransferMaxEntries = DefaultTransferMaxEntries()
	}
	if c.TransferMaxDepth == 0 {
		c.TransferMaxDepth = DefaultTransferMaxDepth()
	}
	if c.SFTPMaxIdleTimeSeconds <= 0 {
		c.SFTPMaxIdleTimeSeconds = 120
	}
	if c.SFTPCleanupIntervalSeconds <= 0 {
		c.SFTPCleanupIntervalSeconds = 30
	}
	if c.SFTPConnTimeoutSeconds <= 0 {
		c.SFTPConnTimeoutSeconds = 10
	}
}

func (c *SystemConfig) ApplyJobQueueDefaults() {
	if c != nil && c.JobQueueMaxConcurrency <= 0 {
		c.JobQueueMaxConcurrency = DefaultJobQueueMaxConcurrency()
	}
}
