package auditlog

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Service interface {
	Log(ctx context.Context, req *CreateAuditLogRequest) error
	LogSuccess(ctx context.Context, userID uuid.UUID, username string, action ActionType, resource string, details interface{}) error
	LogFailure(ctx context.Context, userID uuid.UUID, username string, action ActionType, resource string, err error) error
	List(ctx context.Context, req *ListAuditLogsRequest) ([]*AuditLogSummary, int64, error)
	GetByID(ctx context.Context, id uuid.UUID) (*AuditLog, error)
	GetStatistics(ctx context.Context, req *AuditLogStatisticsRequest) (*AuditLogStatistics, error)
	CleanupOldLogs(ctx context.Context, retentionDays int) (int64, error)
}

type service struct {
	repo Repository
}

func NewService(repo Repository) Service {
	return &service{repo: repo}
}

func (s *service) Log(ctx context.Context, req *CreateAuditLogRequest) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
	}
	log := &AuditLog{
		UserID:    req.UserID,
		Username:  req.Username,
		ServerID:  req.ServerID,
		Type:      req.Type,
		Action:    req.Action,
		Category:  CategoryOf(req.Action),
		Resource:  req.Resource,
		Source:    req.Source,
		Status:    req.Status,
		IP:        req.IP,
		UserAgent: req.UserAgent,
		Details:   req.Details,
		ErrorMsg:  req.ErrorMsg,
		Duration:  req.Duration,
	}

	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if err = s.repo.Create(ctx, log); err == nil {
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

func (s *service) LogSuccess(ctx context.Context, userID uuid.UUID, username string, action ActionType, resource string, details interface{}) error {
	detailsJSON := ""
	if details != nil {
		if data, err := json.Marshal(details); err == nil {
			detailsJSON = string(data)
		}
	}

	return s.Log(ctx, &CreateAuditLogRequest{
		UserID:   userID,
		Username: username,
		Action:   action,
		Resource: resource,
		Status:   StatusSuccess,
		Details:  detailsJSON,
	})
}

func (s *service) LogFailure(ctx context.Context, userID uuid.UUID, username string, action ActionType, resource string, err error) error {
	return s.Log(ctx, &CreateAuditLogRequest{
		UserID:   userID,
		Username: username,
		Action:   action,
		Resource: resource,
		Status:   StatusFailure,
		ErrorMsg: err.Error(),
	})
}

func (s *service) List(ctx context.Context, req *ListAuditLogsRequest) ([]*AuditLogSummary, int64, error) {
	if req == nil {
		req = &ListAuditLogsRequest{}
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.PageSize < 1 {
		req.PageSize = 20
	}
	if req.PageSize > 100 {
		req.PageSize = 100
	}
	return s.repo.List(ctx, req)
}

func (s *service) GetByID(ctx context.Context, id uuid.UUID) (*AuditLog, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *service) GetStatistics(ctx context.Context, req *AuditLogStatisticsRequest) (*AuditLogStatistics, error) {
	if req == nil {
		req = &AuditLogStatisticsRequest{}
	}
	if req.Days <= 0 && req.StartTime == nil {
		req.Days = 30
	}
	if req.Days > 365 {
		req.Days = 365
	}

	return s.repo.GetStatistics(ctx, req)
}

func (s *service) CleanupOldLogs(ctx context.Context, retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		retentionDays = 90
	}

	before := time.Now().AddDate(0, 0, -retentionDays)
	return s.repo.DeleteOldLogs(ctx, before, "")
}
