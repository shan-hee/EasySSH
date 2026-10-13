package dashboard

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository interface {
	CountCommandsSince(ctx context.Context, userID *uuid.UUID, since time.Time) (int64, error)
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
		RegionServer
		Country     string
		CountryCode string
	}

	query := r.db.WithContext(ctx).
		Table("servers").
		Select("id, name, host, port, username, status, country, country_code").
		Where("deleted_at IS NULL").
		Order("sort_order ASC, name ASC, id ASC")

	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	}

	if err := query.Scan(&results).Error; err != nil {
		return nil, err
	}

	distribution := make([]RegionCount, 0, len(results))
	regionIndices := make(map[string]int)
	for _, row := range results {
		code := strings.ToUpper(strings.TrimSpace(row.CountryCode))
		if code == "" || code == "LAN" {
			continue
		}
		index, exists := regionIndices[code]
		if !exists {
			name := row.Country
			if name == "" {
				name = code
			}
			index = len(distribution)
			regionIndices[code] = index
			distribution = append(distribution, RegionCount{Region: name, CountryCode: code})
		}
		region := &distribution[index]
		region.Servers = append(region.Servers, row.RegionServer)
		region.Count = len(region.Servers)
	}
	sort.Slice(distribution, func(i, j int) bool {
		if distribution[i].Count == distribution[j].Count {
			return distribution[i].CountryCode < distribution[j].CountryCode
		}
		return distribution[i].Count > distribution[j].Count
	})
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
