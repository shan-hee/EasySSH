package operationrecord

import (
	"context"
	"time"

	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/easyssh/shared/resultstore"
	"github.com/google/uuid"
)

type Service interface {
	SetPublisher(*realtime.Hub)
	Overview(context.Context, OverviewRequest) (*Overview, error)
	EnsureCoverage(context.Context) error
	RecoverInterrupted(context.Context) error
	Upsert(ctx context.Context, record *OperationRecord) error
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	GetByID(ctx context.Context, id uuid.UUID) (*OperationRecord, error)
	GetStatistics(ctx context.Context, req *StatisticsRequest) (*Statistics, error)
	DeleteOld(ctx context.Context, before time.Time, category Category) (int64, error)
}

type service struct {
	events *realtime.Hub
	repo   Repository
}

func NewService(repo Repository) Service {
	return &service{repo: repo}
}

func (s *service) Upsert(ctx context.Context, record *OperationRecord) error {
	if err := resultstore.Write(ctx, func(attempt context.Context) error { return s.repo.Upsert(attempt, record) }); err != nil {
		return err
	}
	if record != nil && s.events != nil {
		s.events.Publish(record.Actor, "activity.updated", map[string]interface{}{"record_id": record.ID, "work_id": record.WorkID, "status": record.Status})
	}
	return nil
}

func (s *service) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	return s.repo.List(ctx, req)
}

func (s *service) GetByID(ctx context.Context, id uuid.UUID) (*OperationRecord, error) {
	return s.repo.GetByID(ctx, id)
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

func (s *service) DeleteOld(ctx context.Context, before time.Time, category Category) (int64, error) {
	return s.repo.DeleteOld(ctx, before, category)
}

func (s *service) Overview(ctx context.Context, req OverviewRequest) (*Overview, error) {
	return s.repo.Overview(ctx, req)
}
func (s *service) EnsureCoverage(ctx context.Context) error { return s.repo.EnsureCoverage(ctx) }

func (s *service) SetPublisher(events *realtime.Hub) { s.events = events }
