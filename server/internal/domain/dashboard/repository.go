package dashboard

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"sort"
	"strings"

	"database/sql"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"gorm.io/gorm"
)

// A stored server.status is the last connection outcome, not current presence.
const connectedServerPredicate = `EXISTS (
 SELECT 1 FROM operation_records AS connections
 WHERE connections.server_id = servers.id AND connections.type = 'connection'
 AND connections.status = 'running' AND connections.established_at IS NOT NULL
 AND connections.finished_at IS NULL AND connections.deleted_at IS NULL
)`

type Repository interface {
	Overview(context.Context, string) (*Overview, error)
}

type repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

func (r *repository) CountActiveSessions(ctx context.Context) (int64, error) {
	query := r.db.WithContext(ctx).
		Table("operation_records").
		Where("type = ? AND status = ? AND established_at IS NOT NULL AND finished_at IS NULL AND deleted_at IS NULL", "connection", "running")

	var count int64
	err := query.Count(&count).Error
	return count, err
}

func (r *repository) GetServerDistribution(ctx context.Context) ([]protocol.DashboardRegionCount, error) {
	var results []struct {
		protocol.DashboardRegionServer
		Country     string
		CountryCode string
	}

	query := r.db.WithContext(ctx).
		Table("servers").
		Select("id, name, host, port, username, country, country_code, " + connectedServerPredicate + " AS connected").
		Where("deleted_at IS NULL").
		Order("sort_order ASC, name ASC, id ASC")

	if err := query.Scan(&results).Error; err != nil {
		return nil, err
	}

	distribution := make([]protocol.DashboardRegionCount, 0, len(results))
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
			distribution = append(distribution, protocol.DashboardRegionCount{Region: name, CountryCode: code})
		}
		region := &distribution[index]
		region.Servers = append(region.Servers, row.DashboardRegionServer)
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

func (r *repository) CountServers(ctx context.Context) (int64, int64, error) {
	base := r.db.WithContext(ctx).Table("servers").Where("deleted_at IS NULL")

	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return 0, 0, err
	}

	var connected int64
	if err := base.Session(&gorm.Session{}).Where(connectedServerPredicate).Count(&connected).Error; err != nil {
		return 0, 0, err
	}

	return total, connected, nil
}

func (r *repository) Overview(ctx context.Context, timezone string) (*Overview, error) {
	if err := access.Current(ctx).RequireOwner(ctx, protocol.ActivityRead); err != nil {
		return nil, err
	}
	opts := &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}
	if r.db.Dialector.Name() == "sqlite" {
		opts = &sql.TxOptions{}
	}
	var out Overview
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The activity request anchors the snapshot; resource counts use the same tx.
		// Reusing the activity aggregation keeps today's count identical to the
		// activity page; only one record is paged since none are returned.
		activity, err := operationrecord.NewRepository(tx, nil).Overview(ctx, operationrecord.OverviewRequest{Timezone: timezone, Range: "today", PageSize: 1})
		if err != nil {
			return err
		}
		out.Stats.TodayExecutions = activity.Volume.Executions
		snapshot := &repository{db: tx}
		out.Stats.TotalServers, out.Stats.ConnectedServers, err = snapshot.CountServers(ctx)
		if err != nil {
			return err
		}
		out.Stats.ActiveSessions, err = snapshot.CountActiveSessions(ctx)
		if err != nil {
			return err
		}
		out.Distribution, err = snapshot.GetServerDistribution(ctx)
		return err
	}, opts)
	return &out, err
}
