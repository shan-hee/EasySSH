package security

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"reflect"
	"slices"
	"strconv"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository 安全配置仓库接口
type Repository interface {
	// Get 获取安全配置（单例模式）
	Get(ctx context.Context) (*SecurityConfig, error)

	SaveWorkspace(ctx context.Context, config *SecurityConfig) error
	SaveLoginSession(ctx context.Context, config *SecurityConfig) error
	SaveLoginSecurity(ctx context.Context, config *SecurityConfig) error
	SaveWebSecurity(ctx context.Context, config *SecurityConfig) error
	SaveCORS(ctx context.Context, config *SecurityConfig) error
	SaveAccessControl(ctx context.Context, config *SecurityConfig) error

	// GetCORSConfig 获取CORS配置
	GetCORSConfig(ctx context.Context) (*CORSConfig, error)
}

type repository struct {
	db *gorm.DB
}

// NewRepository 创建安全配置仓库
func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

// Get 获取安全配置
func (r *repository) Get(ctx context.Context) (*SecurityConfig, error) {
	var config SecurityConfig

	// 查询第一条记录（单例模式）
	err := r.db.WithContext(ctx).First(&config).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 如果不存在，创建默认配置
			config = SecurityConfig{
				SessionTimeout:   30,
				MaxTabs:          10,
				InactiveMinutes:  15,
				RememberLogin:    true,
				Hibernate:        true,
				LoginLimit:       5,
				APILimit:         100,
				TwoFALimit:       5,
				TrustedProxies:   "127.0.0.1\n::1",
				CookieSecureMode: "auto",
				CookieSameSite:   "lax",

				AccountLockEnabled:         true,
				MaxIPFailAttempts:          10,
				IPLockDurationMinutes:      30,
				MaxAccountFailAttempts:     5,
				AccountLockDurationMinutes: 60,
			}

			// 序列化默认CORS配置
			if cors, err := json.Marshal(DefaultCORSConfig()); err == nil {
				config.CORSConfig = string(cors)
			}

			// 创建默认配置
			if err := r.db.WithContext(ctx).Create(&config).Error; err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}

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
		if err := tx.Model(&SecurityConfig{}).Clauses(clause.Locking{Strength: "UPDATE"}).Select(columns).Where("id=?", existing.ID).Take(&before).Error; err != nil {
			return err
		}
		if err := tx.Model(&SecurityConfig{}).Where("id=?", existing.ID).Updates(values).Error; err != nil {
			return err
		}
		// Read both sides through the driver so numeric/bool representations match.
		after := map[string]any{}
		if err := tx.Model(&SecurityConfig{}).Select(columns).Where("id=?", existing.ID).Take(&after).Error; err != nil {
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
			Action: "security_settings_update", ResourceKind: "security_config", ResourceID: strconv.FormatUint(uint64(existing.ID), 10),
			Name: "安全设置", Source: "manual", Fields: fields,
		})
	})
}

func (r *repository) SaveWorkspace(ctx context.Context, config *SecurityConfig) error {
	return r.update(ctx, map[string]any{
		"max_tabs":         config.MaxTabs,
		"inactive_minutes": config.InactiveMinutes,
		"hibernate":        config.Hibernate,
	})
}

func (r *repository) SaveLoginSession(ctx context.Context, config *SecurityConfig) error {
	return r.update(ctx, map[string]any{
		"session_timeout": config.SessionTimeout,
		"remember_login":  config.RememberLogin,
	})
}

func (r *repository) SaveLoginSecurity(ctx context.Context, config *SecurityConfig) error {
	return r.update(ctx, map[string]any{
		"login_limit":  config.LoginLimit,
		"api_limit":    config.APILimit,
		"two_fa_limit": config.TwoFALimit,
	})
}

func (r *repository) SaveWebSecurity(ctx context.Context, config *SecurityConfig) error {
	return r.update(ctx, map[string]any{
		"trusted_proxies":         config.TrustedProxies,
		"cookie_secure_mode":      config.CookieSecureMode,
		"cookie_domain":           config.CookieDomain,
		"cookie_same_site":        config.CookieSameSite,
		"csrf_trusted_origins":    config.CSRFTrustedOrigins,
		"content_security_policy": config.ContentSecurityPolicy,
	})
}

func (r *repository) SaveCORS(ctx context.Context, config *SecurityConfig) error {
	return r.update(ctx, map[string]any{"cors_config": config.CORSConfig})
}

func (r *repository) SaveAccessControl(ctx context.Context, config *SecurityConfig) error {
	return r.update(ctx, map[string]any{
		"allowlist_ips": config.AllowlistIPs,
		"blocklist_ips": config.BlocklistIPs,
	})
}

// GetCORSConfig 获取CORS配置
func (r *repository) GetCORSConfig(ctx context.Context) (*CORSConfig, error) {
	config, err := r.Get(ctx)
	if err != nil {
		return nil, err
	}

	if config.CORSConfig == "" {
		return DefaultCORSConfig(), nil
	}

	var cors CORSConfig
	if err := json.Unmarshal([]byte(config.CORSConfig), &cors); err != nil {
		return DefaultCORSConfig(), nil
	}

	return &cors, nil
}
