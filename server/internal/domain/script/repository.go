package script

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/scriptutil"
	"slices"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CatalogEntry struct {
	ID          uuid.UUID
	Name        string
	Description string
	Language    string
	Version     string
}

// Repository 脚本数据访问接口
type Repository interface {
	Create(ctx context.Context, script *Script) error
	Update(ctx context.Context, id uuid.UUID, expectedContent, expectedLanguage string, updates map[string]interface{}) error
	Delete(ctx context.Context, id uuid.UUID) error
	GetByID(ctx context.Context, id uuid.UUID) (*Script, error)
	List(ctx context.Context, req *ListScriptsRequest) ([]Script, int64, error)
	IncrementExecutions(ctx context.Context, id uuid.UUID, expectedVersion string) error
	Available(context.Context, string, string, protocol.ScriptCatalogInput) ([]CatalogEntry, bool, error)
}

type repository struct {
	db *gorm.DB
}

// NewRepository 创建脚本仓储实例
func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

// Create 创建脚本
func (r *repository) Create(ctx context.Context, script *Script) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(script).Error; err != nil {
			return err
		}
		return recordConfiguration(tx, "script_create", *script, []string{"created"})
	})
}

// Update 更新脚本
func (r *repository) Update(ctx context.Context, id uuid.UUID, expectedContent, expectedLanguage string, updates map[string]interface{}) error {
	content, hasContent := updates["content"].(string)
	language, hasLanguage := updates["language"].(string)
	if !hasContent || !hasLanguage {
		return ErrInvalidScriptData
	}
	updates["version"] = scriptutil.Version(language, content)
	if tags, ok := updates["tags"].([]string); ok {
		encoded, err := json.Marshal(tags)
		if err != nil {
			return fmt.Errorf("encode script tags: %w", err)
		}
		updates["tags"] = string(encoded)
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var before Script
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&before, "id=?", id).Error; err != nil {
			return err
		}
		if before.Content != expectedContent || before.Language != expectedLanguage {
			return access.ErrResourceChanged
		}
		if err := tx.Model(&Script{}).Where("id=?", id).Updates(updates).Error; err != nil {
			return err
		}
		var after Script
		if err := tx.First(&after, "id=?", id).Error; err != nil {
			return err
		}
		fields := []string{}
		for _, field := range []struct {
			name    string
			changed bool
		}{
			{"name", before.Name != after.Name}, {"description", before.Description != after.Description},
			{"content", before.Content != after.Content}, {"language", before.Language != after.Language}, {"tags", !slices.Equal(before.Tags, after.Tags)},
		} {
			if field.changed {
				fields = append(fields, field.name)
			}
		}
		if len(fields) == 0 {
			return nil
		}
		return recordConfiguration(tx, "script_update", after, fields)
	})
}

// Delete 删除脚本，副本进入回收站
func (r *repository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row, err := DeleteArchived(tx, id)
		if err != nil {
			return err
		}
		return recordConfiguration(tx, "script_delete", row, []string{"deleted"})
	})
}

func recordConfiguration(tx *gorm.DB, action string, row Script, fields []string) error {
	return operationrecord.RecordConfiguration(tx, access.Current(tx.Statement.Context).Actor(), operationrecord.ConfigurationChange{
		Action: action, ResourceKind: "script", ResourceID: row.ID.String(), Name: row.Name, Source: "manual", Fields: fields,
	})
}

// GetByID 根据ID获取脚本
func (r *repository) GetByID(ctx context.Context, id uuid.UUID) (*Script, error) {
	var script Script
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&script).Error
	if err != nil {
		return nil, err
	}
	return &script, nil
}

// List 获取脚本列表
func (r *repository) List(ctx context.Context, req *ListScriptsRequest) ([]Script, int64, error) {
	var scripts []Script
	var total int64

	query := r.db.WithContext(ctx).Model(&Script{})

	// 搜索关键词
	if req.Search != "" {
		searchPattern := "%" + strings.ToLower(req.Search) + "%"
		query = query.Where("LOWER(name) LIKE ? OR LOWER(description) LIKE ?", searchPattern, searchPattern)
	}

	// 语言筛选
	if req.Language != "" {
		query = query.Where("language = ?", req.Language)
	}

	// 标签筛选
	if len(req.Tags) > 0 {
		for _, tag := range req.Tags {
			query = applyTagFilter(query, r.db.Dialector.Name(), tag)
		}
	}

	// 统计总数(如果需要)
	if !req.SkipCount {
		if err := query.Count(&total).Error; err != nil {
			return nil, 0, err
		}
	}

	// 分页
	if req.Page < 1 {
		req.Page = 1
	}
	if req.Limit < 1 {
		req.Limit = 20
	}
	offset := (req.Page - 1) * req.Limit

	// 查询数据
	err := query.Order("updated_at DESC").
		Offset(offset).
		Limit(req.Limit).
		Find(&scripts).Error

	if err != nil {
		return nil, 0, err
	}

	return scripts, total, nil
}

func applyTagFilter(query *gorm.DB, driver, tag string) *gorm.DB {
	switch driver {
	case "sqlite":
		return query.Where("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)", tag)
	case "mysql":
		return query.Where("JSON_CONTAINS(tags, JSON_QUOTE(?))", tag)
	case "postgres":
		payload, err := json.Marshal([]string{tag})
		if err != nil {
			return query.Where("1 = 0")
		}
		return query.Where("CAST(tags AS jsonb) @> CAST(? AS jsonb)", string(payload))
	default:
		escaped := strings.ReplaceAll(tag, `"`, `\"`)
		return query.Where("tags LIKE ?", fmt.Sprintf("%%\"%s\"%%", escaped))
	}
}

// IncrementExecutions 增加执行次数
func (r *repository) IncrementExecutions(ctx context.Context, id uuid.UUID, expectedVersion string) error {
	row, err := r.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if scriptutil.Version(row.Language, row.Content) != expectedVersion {
		return access.ErrResourceChanged
	}
	result := r.db.WithContext(ctx).Model(&Script{}).
		Where("id = ? AND content = ? AND language = ?", id, row.Content, row.Language).
		UpdateColumn("executions", gorm.Expr("executions + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return access.ErrResourceChanged
	}
	return nil
}

// The catalogue selects metadata only. Versions are saved with source changes,
// so browsing never needs to load or hash executable content.
func (r *repository) Available(ctx context.Context, grantID, serverID string, input protocol.ScriptCatalogInput) ([]CatalogEntry, bool, error) {
	var rows []CatalogEntry
	query := r.db.WithContext(ctx).Table("scripts").
		Select("id", "name", "description", "language", "version")
	if grantID != "" {
		query = query.Where("EXISTS (SELECT 1 FROM grant_script_scopes AS scopes WHERE scopes.grant_id = ? AND scopes.server_id = ? AND scopes.script_id = scripts.id AND scopes.version = scripts.version)", grantID, serverID)
	}
	if input.AfterID != "" {
		query = query.Where("id > ?", input.AfterID)
	}
	err := query.Order("id ASC").Limit(input.Limit + 1).Scan(&rows).Error
	if err != nil {
		return nil, false, err
	}
	more := len(rows) > input.Limit
	if more {
		rows = rows[:input.Limit]
	}
	return rows, more, nil
}
