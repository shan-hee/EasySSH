package server

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"strings"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalidServer        = errors.New("invalid server configuration")
	ErrServerNotFound       = errors.New("server not found")
	ErrServerAlreadyExists  = errors.New("server already exists")
	ErrServerUpdateConflict = errors.New("server configuration changed; reload before saving")
	ErrUnauthorized         = errors.New("unauthorized to access this server")
)

// Repository 服务器数据访问接口
type Query struct {
	ServerIDs []string
	Search    string
	GroupID   string
	Tag       string
}
type Repository interface {
	Create(context.Context, *Server) error
	FindByID(context.Context, uuid.UUID) (*Server, error)
	Query(context.Context, Query, int, int) ([]*Server, int64, error)
	Update(context.Context, *Server) error
	UpdateStatus(context.Context, uuid.UUID, ServerStatus, *time.Time) error
	UpdateOSIfEmpty(context.Context, uuid.UUID, string) error
	Delete(context.Context, uuid.UUID) error
	Reorder(context.Context, []uuid.UUID) error
	GetStatistics(context.Context, Query) (*protocol.ServerStatistics, error)
}

// gormRepository GORM 实现
type gormRepository struct {
	db      *gorm.DB
	runtime *access.Runtime
}

// NewRepository 创建服务器仓储
func NewRepository(db *gorm.DB, runtime *access.Runtime) Repository {
	return &gormRepository{db: db, runtime: runtime}
}

func (r *gormRepository) Create(ctx context.Context, server *Server) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Server{}).
			Select("COALESCE(MAX(sort_order), -1) + 1").Scan(&server.SortOrder).Error; err != nil {
			return err
		}
		if err := validateJumpServer(tx, server); err != nil {
			return err
		}
		if err := resolveServerGroup(tx, server); err != nil {
			return err
		}
		if err := tx.Omit("Auth.SSHKey", "GroupRecord", "TagRecords").Create(server).Error; err != nil {
			return err
		}
		if err := server.SaveTags(tx); err != nil {
			return err
		}
		return recordServerConfiguration(tx, "server_create", *server, []string{"created"})
	})
}

func (r *gormRepository) FindByID(ctx context.Context, id uuid.UUID) (*Server, error) {
	var server Server
	if err := r.db.WithContext(ctx).Preload("Auth.SSHKey").Preload("GroupRecord").Preload("TagRecords").Where("id = ?", id).First(&server).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrServerNotFound
		}
		return nil, err
	}
	return &server, nil
}

func (r *gormRepository) Update(ctx context.Context, server *Server) error {
	changed := false
	var dependents []string
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current Server
		if err := validateJumpServer(tx, server); err != nil {
			return err
		}
		if err := resolveServerGroup(tx, server); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("Auth").Preload("TagRecords").Where("id = ?", server.ID).First(&current).Error; err != nil {
			return err
		}
		if server.ConnectionRevision != current.ConnectionRevision || !server.UpdatedAt.Equal(current.UpdatedAt) {
			return ErrServerUpdateConflict
		}
		sameKey := current.Auth.SSHKeyID == nil && server.Auth.SSHKeyID == nil ||
			current.Auth.SSHKeyID != nil && server.Auth.SSHKeyID != nil && *current.Auth.SSHKeyID == *server.Auth.SSHKeyID
		changed = current.Host != server.Host || current.Port != server.Port || current.Username != server.Username || current.Auth.AuthMethod != server.Auth.AuthMethod || !sameKey || jumpID(current.JumpServerID) != jumpID(server.JumpServerID)
		if changed {
			server.ConnectionRevision++
		}
		// Compare timestamps as instants above, not as SQL text: SQLite can store
		// RFC3339 and driver-formatted timestamps for the same instant. The row
		// lock (or SQLite transaction snapshot) protects this read/update pair.
		result := tx.Model(&Server{}).Where("id = ? AND connection_revision = ?", server.ID, current.ConnectionRevision).
			Select("*").Omit("ID", "CreatedAt", "Auth", "GroupRecord", "TagRecords").Updates(server)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrServerUpdateConflict
		}
		if err := server.SaveAuth(tx); err != nil {
			return err
		}
		if err := server.SaveTags(tx); err != nil {
			return err
		}
		if changed || current.Auth.Password != server.Auth.Password {
			var err error
			dependents, err = InvalidateJumpDependents(tx, server.ID)
			if err != nil {
				return err
			}
		}
		if fields := serverChangedFields(current, *server); len(fields) > 0 {
			return recordServerConfiguration(tx, "server_update", *server, fields)
		}
		return nil
	})
	if err == nil {
		for _, id := range dependents {
			r.runtime.InvalidateVisitors(id, access.ErrResourceChanged)
		}
	}
	if err == nil && changed {
		r.runtime.InvalidateVisitors(server.ID.String(), access.ErrResourceChanged)
	}
	return err
}

// UpdateStatus 仅更新服务器状态和最后连接时间（性能优化）
// 这个方法只更新 2 个字段，避免 Save() 更新所有字段导致的慢查询
// 注意：使用 UpdateColumn 而不是 Updates，避免触发 gorm 的 updated_at 钩子
// 使用 Unscoped() 跳过软删除检查，提升性能（因为主键查询不需要检查 deleted_at）
func (r *gormRepository) UpdateStatus(ctx context.Context, serverID uuid.UUID, status ServerStatus, lastConnected *time.Time) error {
	updates := map[string]interface{}{
		"status": status,
	}
	if lastConnected != nil {
		updates["last_connected"] = lastConnected
	}

	// 使用 Unscoped() 跳过软删除条件，直接通过主键更新
	// 这样可以使用主键索引，性能提升显著（从 200ms+ 降至 <5ms）
	result := r.db.WithContext(ctx).
		Model(&Server{}).
		Unscoped().
		Where("id = ?", serverID).
		UpdateColumns(updates)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrServerNotFound
	}
	return nil
}

func (r *gormRepository) UpdateOSIfEmpty(ctx context.Context, serverID uuid.UUID, osValue string) error {
	osValue = strings.TrimSpace(osValue)
	if osValue == "" {
		return nil
	}

	result := r.db.WithContext(ctx).
		Model(&Server{}).
		Unscoped().
		Where("id = ? AND (os = '' OR os IS NULL)", serverID).
		UpdateColumns(map[string]interface{}{
			"os":         osValue,
			"updated_at": time.Now(),
		})

	if result.Error != nil {
		return result.Error
	}
	return nil
}

func (r *gormRepository) Delete(ctx context.Context, id uuid.UUID) error {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Server
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "name", "host").First(&row, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrServerNotFound
			}
			return err
		}
		if err := DeleteConfiguration(tx, id); err != nil {
			return err
		}
		return recordServerConfiguration(tx, "server_delete", row, []string{"deleted"})
	})
	if err == nil {
		r.runtime.InvalidateVisitors(id.String(), access.ErrResourceChanged)
	}
	return err
}

func (r *gormRepository) query(ctx context.Context, filter Query) *gorm.DB {
	q := r.db.WithContext(ctx).Model(&Server{})
	if filter.ServerIDs != nil {
		q = q.Where("id IN ?", filter.ServerIDs)
	}
	if filter.Search != "" {
		pattern := "%" + strings.ToLower(filter.Search) + "%"
		q = q.Where("LOWER(name) LIKE ? OR LOWER(host) LIKE ? OR LOWER(username) LIKE ? OR EXISTS (SELECT 1 FROM server_groups g WHERE g.id = servers.group_id AND LOWER(g.name) LIKE ?) OR LOWER(description) LIKE ? OR EXISTS (SELECT 1 FROM server_tags st WHERE st.server_id=servers.id AND LOWER(st.tag_name) LIKE ?)", pattern, pattern, pattern, pattern, pattern, pattern)
	}
	if filter.GroupID != "" {
		q = q.Where("group_id=?", filter.GroupID)
	}
	if filter.Tag != "" {
		q = q.Where("EXISTS (SELECT 1 FROM server_tags st WHERE st.server_id=servers.id AND st.tag_name=?)", filter.Tag)
	}
	return q
}
func (r *gormRepository) Query(ctx context.Context, filter Query, limit, offset int) ([]*Server, int64, error) {
	var total int64
	if err := r.query(ctx, filter).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := []*Server{}
	err := r.query(ctx, filter).Preload("Auth.SSHKey").Preload("GroupRecord").Preload("TagRecords").Order("sort_order ASC,created_at ASC,id ASC").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, total, err
}

// Reorder 保留未提交服务器的位置，适用于分页和筛选后的拖拽。
// 使用事务确保原子性，避免部分更新失败
func (r *gormRepository) Reorder(ctx context.Context, serverIDs []uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		selected := make(map[uuid.UUID]bool, len(serverIDs))
		for _, id := range serverIDs {
			if id == uuid.Nil || selected[id] {
				return errors.New("server IDs must be non-empty and unique")
			}
			selected[id] = true
		}
		var ordered []Server
		if err := tx.Model(&Server{}).
			Select("id", "name", "host", "sort_order").Order("sort_order ASC, created_at ASC, id ASC").Find(&ordered).Error; err != nil {
			return err
		}
		orderedIDs := make([]uuid.UUID, len(ordered))
		byID := make(map[uuid.UUID]Server, len(ordered))
		for i, row := range ordered {
			orderedIDs[i], byID[row.ID] = row.ID, row
		}
		var slots []int
		for index, id := range orderedIDs {
			if selected[id] {
				slots = append(slots, index)
			}
		}
		if len(slots) != len(serverIDs) {
			return ErrServerNotFound
		}
		for index, slot := range slots {
			orderedIDs[slot] = serverIDs[index]
		}
		resources := []operationrecord.ResourceSnapshot{}
		for index, id := range orderedIDs {
			if byID[id].SortOrder == index {
				continue
			}
			if err := tx.Model(&Server{}).Where("id = ?", id).
				UpdateColumn("sort_order", index).Error; err != nil {
				return err
			}
			resources = append(resources, serverActivityResource(byID[id]))
		}
		if len(resources) > 0 {
			return operationrecord.RecordConfiguration(tx, access.Current(ctx).Actor(), operationrecord.ConfigurationChange{
				Action: "server_reorder", ResourceKind: "workspace", ResourceID: "servers", Name: "服务器排列", Source: "manual",
				Fields: []string{"sort_order"}, Resources: resources,
			})
		}
		return nil
	})
}

func (r *gormRepository) GetStatistics(ctx context.Context, filter Query) (*protocol.ServerStatistics, error) {
	var online, offline int64
	stats := &protocol.ServerStatistics{Online: &online, Offline: &offline, ByGroup: make(map[string]int64), ByTag: make(map[string]int64)}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scoped := &gormRepository{db: tx, runtime: r.runtime}
		type countRow struct {
			Name  string
			Count int64
		}
		var statuses []countRow
		if err := scoped.query(ctx, filter).Select("status AS name,COUNT(*) AS count").Group("status").Scan(&statuses).Error; err != nil {
			return err
		}
		for _, row := range statuses {
			stats.Total += row.Count
			if row.Name == string(StatusOnline) {
				online += row.Count
			} else {
				offline += row.Count
			}
		}
		var groups []countRow
		if err := scoped.query(ctx, filter).Where("group_id IS NOT NULL").Select("group_id AS name,COUNT(*) AS count").Group("group_id").Scan(&groups).Error; err != nil {
			return err
		}
		for _, row := range groups {
			stats.ByGroup[row.Name] = row.Count
		}
		var tags []countRow
		if err := tx.Model(&ServerTag{}).Where("server_id IN (?)", scoped.query(ctx, filter).Select("id")).Select("tag_name AS name,COUNT(*) AS count").Group("tag_name").Scan(&tags).Error; err != nil {
			return err
		}
		for _, row := range tags {
			stats.ByTag[row.Name] = row.Count
		}
		return nil
	})
	return stats, err
}
