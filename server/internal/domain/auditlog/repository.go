package auditlog

import (
	"context"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository interface {
	Create(ctx context.Context, log *AuditLog) error
	List(ctx context.Context, req *ListAuditLogsRequest) ([]*AuditLogSummary, int64, error)
	GetByID(ctx context.Context, id uuid.UUID) (*AuditLog, error)
	GetStatistics(ctx context.Context, req *AuditLogStatisticsRequest) (*AuditLogStatistics, error)
	DeleteOldLogs(ctx context.Context, before time.Time, category LogCategory) (int64, error)
}

type repository struct {
	db      *gorm.DB
	records operationrecord.Repository
}

func NewRepository(db *gorm.DB) Repository {
	return &repository{
		db:      db,
		records: operationrecord.NewRepository(db),
	}
}

func (r *repository) Create(ctx context.Context, log *AuditLog) error {
	record := auditLogToOperationRecord(log)
	return r.records.Upsert(ctx, record)
}

func (r *repository) List(ctx context.Context, req *ListAuditLogsRequest) ([]*AuditLogSummary, int64, error) {
	result, err := r.records.List(ctx, auditListRequestToOperationRecordRequest(req))
	if err != nil {
		return nil, 0, err
	}

	logs := make([]*AuditLogSummary, 0, len(result.Records))
	for _, record := range result.Records {
		logs = append(logs, operationRecordSummaryToAuditLogSummary(record))
	}

	return logs, result.Total, nil
}

func (r *repository) GetByID(ctx context.Context, id uuid.UUID) (*AuditLog, error) {
	record, err := r.records.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return operationRecordToAuditLog(record), nil
}

func (r *repository) GetStatistics(ctx context.Context, req *AuditLogStatisticsRequest) (*AuditLogStatistics, error) {
	stats := &AuditLogStatistics{
		ActionStats: make(map[ActionType]int64),
	}

	var rows []struct {
		Action string
		Status operationrecord.Status
		Count  int64
	}
	if err := r.statisticsQuery(ctx, req).
		Select("action, status, count(*) as count").
		Group("action, status").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		stats.TotalLogs += row.Count
		stats.ActionStats[ActionType(row.Action)] += row.Count
		switch row.Status {
		case operationrecord.StatusSuccess:
			stats.SuccessCount += row.Count
		case operationrecord.StatusFailure:
			stats.FailureCount += row.Count
		}
	}

	return stats, nil
}

func (r *repository) DeleteOldLogs(ctx context.Context, before time.Time, category LogCategory) (int64, error) {
	return r.records.DeleteOld(ctx, before, mapLogCategory(category))
}

func (r *repository) statisticsQuery(ctx context.Context, req *AuditLogStatisticsRequest) *gorm.DB {
	query := r.db.WithContext(ctx).Model(&operationrecord.OperationRecord{})
	if req == nil {
		return query
	}
	if req.UserID != nil {
		query = query.Where("user_id = ?", *req.UserID)
	}
	if req.Category != "" {
		query = query.Where("category = ?", mapLogCategory(req.Category))
	}
	if req.StartTime != nil {
		query = query.Where("created_at >= ?", *req.StartTime)
	} else if req.Days > 0 {
		query = query.Where("created_at >= ?", time.Now().AddDate(0, 0, -req.Days))
	}
	if req.EndTime != nil {
		query = query.Where("created_at <= ?", *req.EndTime)
	}
	return query
}
