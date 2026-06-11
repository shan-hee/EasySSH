package auditlog

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Service interface {
	Log(ctx context.Context, req *CreateAuditLogRequest) error
	LogSuccess(ctx context.Context, userID uuid.UUID, username string, action ActionType, resource string, details interface{}) error
	LogFailure(ctx context.Context, userID uuid.UUID, username string, action ActionType, resource string, err error) error
	List(ctx context.Context, req *ListAuditLogsRequest) ([]*AuditLog, int64, error)
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

	return s.repo.Create(ctx, log)
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

func (s *service) List(ctx context.Context, req *ListAuditLogsRequest) ([]*AuditLog, int64, error) {
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
