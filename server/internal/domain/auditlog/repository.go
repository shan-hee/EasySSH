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
	List(ctx context.Context, req *ListAuditLogsRequest) ([]*AuditLog, int64, error)
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

func (r *repository) List(ctx context.Context, req *ListAuditLogsRequest) ([]*AuditLog, int64, error) {
	response, err := r.records.List(ctx, auditListRequestToOperationRecordRequest(req))
	if err != nil {
		return nil, 0, err
	}

	logs := make([]*AuditLog, 0, len(response.Records))
	for _, record := range response.Records {
		logs = append(logs, operationRecordToAuditLog(record))
	}

	return logs, response.Total, nil
}

func (r *repository) GetByID(ctx context.Context, id uuid.UUID) (*AuditLog, error) {
	record, err := r.records.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return operationRecordToAuditLog(record), nil
}

func (r *repository) GetStatistics(ctx context.Context, req *AuditLogStatisticsRequest) (*AuditLogStatistics, error) {
	statsReq := &operationrecord.StatisticsRequest{}
	if req != nil {
		statsReq.UserID = req.UserID
		statsReq.Category = mapLogCategory(req.Category)
		statsReq.StartTime = req.StartTime
		statsReq.EndTime = req.EndTime
		statsReq.Days = req.Days
	}

	recordStats, err := r.records.GetStatistics(ctx, statsReq)
	if err != nil {
		return nil, err
	}

	stats := &AuditLogStatistics{
		TotalLogs:      recordStats.Total,
		SuccessCount:   recordStats.SuccessCount,
		FailureCount:   recordStats.FailureCount,
		ActionStats:    make(map[ActionType]int64),
		RecentFailures: make([]*AuditLog, 0, 10),
	}

	var actionRows []struct {
		Action string
		Count  int64
	}
	if err := r.statisticsQuery(ctx, req).
		Select("action, count(*) as count").
		Group("action").
		Find(&actionRows).Error; err != nil {
		return nil, err
	}
	for _, row := range actionRows {
		stats.ActionStats[ActionType(row.Action)] = row.Count
	}

	var failureRows []*operationrecord.OperationRecord
	if err := r.statisticsQuery(ctx, req).
		Where("status = ?", operationrecord.StatusFailure).
		Order("created_at DESC").
		Limit(10).
		Find(&failureRows).Error; err != nil {
		return nil, err
	}
	for _, record := range failureRows {
		stats.RecentFailures = append(stats.RecentFailures, operationRecordToAuditLog(record))
	}

	var userRows []struct {
		UserID   uuid.UUID
		Username string
		Count    int64
	}
	if err := r.statisticsQuery(ctx, req).
		Select("user_id, username, count(*) as count").
		Group("user_id, username").
		Order("count DESC").
		Limit(5).
		Find(&userRows).Error; err != nil {
		return nil, err
	}
	for _, row := range userRows {
		stats.TopUsers = append(stats.TopUsers, UserActionCount{
			UserID:   row.UserID,
			Username: row.Username,
			Count:    row.Count,
		})
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
