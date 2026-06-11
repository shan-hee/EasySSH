package dashboard

import (
	"context"
	"time"

	"github.com/google/uuid"
)

const trendDays = 7

var operationDimension = map[string]string{
	"connection": "connections",
	"transfer":   "uploads",
	"execution":  "commands",
	"audit":      "commands",
}

type Service interface {
	GetOverview(ctx context.Context, userID *uuid.UUID) (*Overview, error)
}

type service struct {
	repo Repository
}

func NewService(repo Repository) Service {
	return &service{repo: repo}
}

func (s *service) GetOverview(ctx context.Context, userID *uuid.UUID) (*Overview, error) {
	now := time.Now()
	windowStart := startOfDay(now.AddDate(0, 0, -(2*trendDays - 1)))

	operationRows, err := s.repo.GetOperationTrendsSince(ctx, userID, windowStart)
	if err != nil {
		return nil, err
	}

	dates := buildDateRange(now, trendDays)
	dateIndex := make(map[string]int, len(dates))
	for i, d := range dates {
		dateIndex[d] = i
	}

	dimensions := []string{"connections", "commands", "uploads", "total"}
	series := make(map[string][]int64, len(dimensions))
	for _, dim := range dimensions {
		series[dim] = make([]int64, len(dates))
	}

	curPeriodStart := startOfDay(now.AddDate(0, 0, -(trendDays - 1)))
	prevPeriodStart := startOfDay(now.AddDate(0, 0, -(2*trendDays - 1)))
	todayStart := startOfDay(now)

	var curCommands, prevCommands, todayCommands int64
	recordTrendEvent := func(createdAt time.Time, dim string) {
		day := createdAt.Local().Format("2006-01-02")
		if idx, ok := dateIndex[day]; ok {
			series[dim][idx]++
			series["total"][idx]++
		}

		if dim == "commands" {
			switch {
			case !createdAt.Before(curPeriodStart):
				curCommands++
			case !createdAt.Before(prevPeriodStart) && createdAt.Before(curPeriodStart):
				prevCommands++
			}
			if !createdAt.Before(todayStart) {
				todayCommands++
			}
		}
	}

	for _, row := range operationRows {
		dim := operationDimension[row.Type]
		if dim == "" {
			dim = "commands"
		}
		recordTrendEvent(row.occurredAt(), dim)
	}

	total, online, err := s.repo.CountServers(ctx, userID)
	if err != nil {
		return nil, err
	}

	activeConns, err := s.repo.CountActiveSessions(ctx, userID)
	if err != nil {
		return nil, err
	}

	distribution, err := s.repo.GetServerDistribution(ctx, userID)
	if err != nil {
		return nil, err
	}

	recentRows, err := s.repo.GetRecentActivity(ctx, userID, 8)
	if err != nil {
		return nil, err
	}
	recentActivity := make([]ActivityItem, 0, len(recentRows))
	for _, row := range recentRows {
		recentActivity = append(recentActivity, ActivityItem{
			ID:        row.ID,
			Action:    row.Action,
			Username:  row.Username,
			Resource:  row.Resource,
			Status:    row.Status,
			IP:        row.IP,
			CreatedAt: row.CreatedAt,
		})
	}

	return &Overview{
		Stats: StatsBlock{
			OnlineServers: MetricWithTrend{
				Value:     float64(online),
				ChangePct: 0,
				Spark:     toFloatSlice(series["connections"]),
			},
			TotalServers: int(total),
			ActiveConns: MetricWithTrend{
				Value:     float64(activeConns),
				ChangePct: 0,
				Spark:     toFloatSlice(series["connections"]),
			},
			TodayCommands: MetricWithTrend{
				Value:     float64(todayCommands),
				ChangePct: percentChange(curCommands, prevCommands),
				Spark:     toFloatSlice(series["commands"]),
			},
		},
		ConnectionTrend: TrendBlock{
			Dates:  dates,
			Series: series,
		},
		Distribution:   distribution,
		RecentActivity: recentActivity,
	}, nil
}

func startOfDay(t time.Time) time.Time {
	lt := t.Local()
	y, m, d := lt.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, lt.Location())
}

func buildDateRange(now time.Time, days int) []string {
	dates := make([]string, 0, days)
	for i := days - 1; i >= 0; i-- {
		dates = append(dates, now.AddDate(0, 0, -i).Local().Format("2006-01-02"))
	}
	return dates
}

func percentChange(cur, prev int64) float64 {
	if prev == 0 {
		if cur > 0 {
			return 100
		}
		return 0
	}
	return float64(cur-prev) / float64(prev) * 100
}

func toFloatSlice(in []int64) []float64 {
	out := make([]float64, len(in))
	for i, v := range in {
		out[i] = float64(v)
	}
	return out
}
