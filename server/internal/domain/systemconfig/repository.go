package systemconfig

import (
	"context"
	"errors"
	"maps"
	"reflect"
	"slices"
	"strconv"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"

	"github.com/easyssh/shared/retention"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository 系统配置仓库接口
type Repository interface {
	// Get 获取系统配置（单例模式，只有一条记录）
	Get(ctx context.Context) (*SystemConfig, error)

	SaveBasic(ctx context.Context, config *SystemConfig) error
	SaveFileTransfer(ctx context.Context, config *SystemConfig) error
	SaveScheduledTasks(ctx context.Context, config *SystemConfig) error
	SaveRetention(ctx context.Context, config *SystemConfig) error
}

type repository struct {
	db *gorm.DB
}

// NewRepository 创建系统配置仓库
func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

// Get 获取系统配置
func (r *repository) Get(ctx context.Context) (*SystemConfig, error) {
	var config SystemConfig

	// 查询第一条记录（单例模式）
	err := r.db.WithContext(ctx).First(&config).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 如果不存在，创建默认配置
			config = SystemConfig{
				SystemName:                 "EasySSH",
				DefaultLanguage:            "zh-CN",
				DefaultTimezone:            "Asia/Shanghai",
				DateFormat:                 "YYYY-MM-DD HH:mm:ss",
				SkipExcludedOnUpload:       true,
				MaxFileUploadSize:          100,
				DownloadExcludePatterns:    DefaultDownloadExcludePatterns(),
				TransferStoragePath:        DefaultTransferStoragePath(),
				TransferRetentionDays:      DefaultTransferRetentionDays(),
				TransferMaxStorageGB:       DefaultTransferMaxStorageGB(),
				TransferMaxConcurrency:     DefaultTransferMaxConcurrency(),
				TransferMaxEntries:         DefaultTransferMaxEntries(),
				TransferMaxDepth:           DefaultTransferMaxDepth(),
				TransferCleanupEnabled:     true,
				JobQueueMaxConcurrency:     DefaultJobQueueMaxConcurrency(),
				TaskRetentionDays:          retention.DefaultDays,
				LogRetentionDays:           retention.DefaultDays,
				DeletedRetentionDays:       retention.DefaultDeletedDays,
				SFTPMaxIdleTimeSeconds:     120,
				SFTPCleanupIntervalSeconds: 30,
				SFTPConnTimeoutSeconds:     10,
				SFTPMaxSessionsPerConn:     8,
			}

			// 创建默认配置
			if err := r.db.WithContext(ctx).Create(&config).Error; err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}

	config.ApplyTransferDefaults()
	config.ApplyJobQueueDefaults()
	return &config, nil
}

func (r *repository) update(ctx context.Context, values map[string]any) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		existing, err := (&repository{db: tx}).Get(ctx)
		if err != nil {
			return err
		}
		columns := slices.Sorted(maps.Keys(values))
		before := map[string]any{}
		if err := tx.Model(&SystemConfig{}).Clauses(clause.Locking{Strength: "UPDATE"}).Select(columns).Where("id=?", existing.ID).Take(&before).Error; err != nil {
			return err
		}
		if err := tx.Model(&SystemConfig{}).Where("id=?", existing.ID).Updates(values).Error; err != nil {
			return err
		}
		// Read both sides through the driver so numeric/bool representations match.
		after := map[string]any{}
		if err := tx.Model(&SystemConfig{}).Select(columns).Where("id=?", existing.ID).Take(&after).Error; err != nil {
			return err
		}
		fields := []string{}
		for _, column := range columns {
			if !reflect.DeepEqual(before[column], after[column]) {
				fields = append(fields, column)
			}
		}
		if len(fields) == 0 {
			return nil
		}
		return operationrecord.RecordConfiguration(tx, access.Current(ctx).Actor(), operationrecord.ConfigurationChange{
			Action: "system_settings_update", ResourceKind: "system_config", ResourceID: strconv.FormatUint(uint64(existing.ID), 10),
			Name: "系统设置", Source: "manual", Fields: fields,
		})
	})
}

func (r *repository) SaveBasic(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"system_name":      config.SystemName,
		"system_logo":      config.SystemLogo,
		"system_favicon":   config.SystemFavicon,
		"default_language": config.DefaultLanguage,
		"default_timezone": config.DefaultTimezone,
		"date_format":      config.DateFormat,
	})
}

func (r *repository) SaveFileTransfer(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"download_exclude_patterns":     config.DownloadExcludePatterns,
		"skip_excluded_on_upload":       config.SkipExcludedOnUpload,
		"max_file_upload_size":          config.MaxFileUploadSize,
		"transfer_storage_path":         config.TransferStoragePath,
		"transfer_retention_days":       config.TransferRetentionDays,
		"transfer_max_storage_gb":       config.TransferMaxStorageGB,
		"transfer_max_concurrency":      config.TransferMaxConcurrency,
		"transfer_max_entries":          config.TransferMaxEntries,
		"transfer_max_depth":            config.TransferMaxDepth,
		"transfer_cleanup_enabled":      config.TransferCleanupEnabled,
		"sftp_max_idle_time_seconds":    config.SFTPMaxIdleTimeSeconds,
		"sftp_cleanup_interval_seconds": config.SFTPCleanupIntervalSeconds,
		"sftp_max_life_time_minutes":    config.SFTPMaxLifeTimeMinutes,
		"sftp_conn_timeout_seconds":     config.SFTPConnTimeoutSeconds,
		"sftp_max_sessions_per_conn":    config.SFTPMaxSessionsPerConn,
	})
}

func (r *repository) SaveScheduledTasks(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"job_queue_max_concurrency": config.JobQueueMaxConcurrency,
	})
}

func (r *repository) SaveRetention(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"task_retention_days":    config.TaskRetentionDays,
		"log_retention_days":     config.LogRetentionDays,
		"deleted_retention_days": config.DeletedRetentionDays,
	})
}
