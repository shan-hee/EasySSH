package dashboard

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository interface {
	CountCommandsSince(ctx context.Context, userID *uuid.UUID, since time.Time) (int64, error)
	CountActiveSessions(ctx context.Context, userID *uuid.UUID) (int64, error)
	GetServerDistribution(ctx context.Context, userID *uuid.UUID) ([]RegionCount, error)
	GetRecentServers(ctx context.Context, userID *uuid.UUID, limit int) ([]RecentServer, error)
	CountServers(ctx context.Context, userID *uuid.UUID) (total int64, online int64, err error)
}

type repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

func (r *repository) CountCommandsSince(ctx context.Context, userID *uuid.UUID, since time.Time) (int64, error) {
	query := r.db.WithContext(ctx).
		Table("operation_records").
		Where("deleted_at IS NULL").
		Where("type IN ?", []string{"execution", "audit"}).
		Where("started_at >= ? OR (started_at IS NULL AND created_at >= ?)", since, since)

	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	}

	var count int64
	err := query.Count(&count).Error
	return count, err
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

func (r *repository) GetRecentServers(ctx context.Context, userID *uuid.UUID, limit int) ([]RecentServer, error) {
	query := r.db.WithContext(ctx).
		Table("servers").
		Select("id, name, host, port, username, server_group, status, country, city, last_connected").
		Where("deleted_at IS NULL")

	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	}

	var servers []RecentServer
	err := query.
		Order("CASE WHEN last_connected IS NULL THEN 1 ELSE 0 END").
		Order("last_connected DESC").
		Order("updated_at DESC").
		Limit(limit).
		Scan(&servers).Error
	return servers, err
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
