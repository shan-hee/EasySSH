package dashboard

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository interface {
	GetOperationTrendsSince(ctx context.Context, userID *uuid.UUID, since time.Time) ([]operationTrendRow, error)
	GetRecentActivity(ctx context.Context, userID *uuid.UUID, limit int) ([]activityLogRow, error)
	CountActiveSessions(ctx context.Context, userID *uuid.UUID) (int64, error)
	GetServerDistribution(ctx context.Context, userID *uuid.UUID) ([]RegionCount, error)
	CountServers(ctx context.Context, userID *uuid.UUID) (total int64, online int64, err error)
}

type repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

func (r *repository) GetOperationTrendsSince(ctx context.Context, userID *uuid.UUID, since time.Time) ([]operationTrendRow, error) {
	query := r.db.WithContext(ctx).
		Table("operation_records").
		Select("type, action, started_at, created_at").
		Where("deleted_at IS NULL AND (started_at >= ? OR (started_at IS NULL AND created_at >= ?))", since, since)

	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	}

	var rows []operationTrendRow
	err := query.Order("created_at ASC").Scan(&rows).Error
	return rows, err
}

func (r *repository) GetRecentActivity(ctx context.Context, userID *uuid.UUID, limit int) ([]activityLogRow, error) {
	if limit <= 0 {
		limit = 8
	}

	query := r.db.WithContext(ctx).
		Table("operation_records").
		Select("id, action, username, COALESCE(NULLIF(resource, ''), NULLIF(title, ''), server_name, source) AS resource, status, ip, created_at").
		Where("deleted_at IS NULL")

	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	}

	var rows []activityLogRow
	err := query.Order("created_at DESC").Limit(limit).Scan(&rows).Error
	return rows, err
}

func (r *repository) CountActiveSessions(ctx context.Context, userID *uuid.UUID) (int64, error) {
	query := r.db.WithContext(ctx).
		Table("operation_records").
		Where("type = ? AND status = ? AND deleted_at IS NULL", "connection", "running")

	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	}

	var count int64
	err := query.Count(&count).Error
	return count, err
}

func (r *repository) GetServerDistribution(ctx context.Context, userID *uuid.UUID) ([]RegionCount, error) {
	var results []struct {
		Country     string
		CountryCode string
		Region      string
		Count       int
	}

	query := r.db.WithContext(ctx).
		Table("servers").
		Select("country, country_code, region, count(*) as count").
		Where("deleted_at IS NULL").
		Group("country, country_code, region").
		Order("count DESC")

	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	}

	if err := query.Scan(&results).Error; err != nil {
		return nil, err
	}

	distribution := make([]RegionCount, 0, len(results))
	for _, row := range results {
		name := row.Country
		if name == "" {
			name = row.Region
		}
		distribution = append(distribution, RegionCount{
			Region:      name,
			CountryCode: row.CountryCode,
			Count:       row.Count,
		})
	}
	return distribution, nil
}

func (r *repository) CountServers(ctx context.Context, userID *uuid.UUID) (int64, int64, error) {
	base := r.db.WithContext(ctx).Table("servers").Where("deleted_at IS NULL")
	if userID != nil {
		base = base.Where("user_id = ?", *userID)
	}

	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return 0, 0, err
	}

	var online int64
	if err := base.Session(&gorm.Session{}).Where("status = ?", "online").Count(&online).Error; err != nil {
		return 0, 0, err
	}

	return total, online, nil
}
