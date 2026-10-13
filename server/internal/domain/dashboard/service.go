package dashboard

import (
	"context"
	"time"

	"github.com/google/uuid"
)

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
	total, online, err := s.repo.CountServers(ctx, userID)
	if err != nil {
		return nil, err
	}

	activeConns, err := s.repo.CountActiveSessions(ctx, userID)
	if err != nil {
		return nil, err
	}

	todayCommands, err := s.repo.CountCommandsSince(ctx, userID, startOfDay(now))
	if err != nil {
		return nil, err
	}

	distribution, err := s.repo.GetServerDistribution(ctx, userID)
	if err != nil {
		return nil, err
	}

	return &Overview{
		Stats: StatsBlock{
			OnlineServers:  online,
			TotalServers:   total,
			ActiveSessions: activeConns,
			TodayCommands:  todayCommands,
		},
		Distribution: distribution,
	}, nil
}

func startOfDay(t time.Time) time.Time {
	lt := t.Local()
	y, m, d := lt.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, lt.Location())
}
