package operationrecord

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Service interface {
	Upsert(ctx context.Context, record *OperationRecord) error
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	GetByID(ctx context.Context, userID, id uuid.UUID) (*OperationRecord, error)
	GetStatistics(ctx context.Context, req *StatisticsRequest) (*Statistics, error)
	DeleteBySource(ctx context.Context, sourceTable string, sourceID string) error
	DeleteOld(ctx context.Context, before time.Time, category Category) (int64, error)
}

type service struct {
	repo Repository
}

func NewService(repo Repository) Service {
	return &service{repo: repo}
}

func (s *service) Upsert(ctx context.Context, record *OperationRecord) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
	}
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if err = s.repo.Upsert(ctx, record); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return errors.Join(err, ctx.Err())
		}
		if attempt == 2 {
			break
		}
		timer := time.NewTimer(time.Duration(attempt+1) * 100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return errors.Join(err, ctx.Err())
		case <-timer.C:
		}
	}
	return err
}

func (s *service) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	return s.repo.List(ctx, req)
}

func (s *service) GetByID(ctx context.Context, userID, id uuid.UUID) (*OperationRecord, error) {
	return s.repo.GetByUserID(ctx, userID, id)
}

func (s *service) GetStatistics(ctx context.Context, req *StatisticsRequest) (*Statistics, error) {
	if req == nil {
		req = &StatisticsRequest{}
	}
	if req.Days <= 0 && req.StartTime == nil {
		req.Days = 30
	}
	return s.repo.GetStatistics(ctx, req)
}

func (s *service) DeleteBySource(ctx context.Context, sourceTable string, sourceID string) error {
	return s.repo.DeleteBySource(ctx, sourceTable, sourceID)
}

func (s *service) DeleteOld(ctx context.Context, before time.Time, category Category) (int64, error) {
	return s.repo.DeleteOld(ctx, before, category)
}
