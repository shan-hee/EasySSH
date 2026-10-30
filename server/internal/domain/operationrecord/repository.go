package operationrecord

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository interface {
	Overview(context.Context, OverviewRequest) (*Overview, error)
	EnsureCoverage(context.Context) error
	RecoverInterrupted(context.Context) error
	Upsert(ctx context.Context, record *OperationRecord) error
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	GetByID(ctx context.Context, id uuid.UUID) (*OperationRecord, error)
	GetStatistics(ctx context.Context, req *StatisticsRequest) (*Statistics, error)
	DeleteOld(ctx context.Context, before time.Time, category Category) (int64, error)
}

type repository struct {
	db     *gorm.DB
	bodies Bodies
}

func NewRepository(db *gorm.DB, bodies Bodies) Repository {
	return &repository{db: db, bodies: bodies}
}

func (r *repository) Upsert(ctx context.Context, record *OperationRecord) error {
	if record == nil {
		return nil
	}
	// Preserve the caller's observed detail if the transaction fails or is retried.
	candidate := *record
	err := r.transaction(ctx, func(tx *gorm.DB) error {
		record := &candidate
		if err := record.BeforeCreate(tx); err != nil {
			return err
		}
		var stored OperationRecord
		err := tx.Unscoped().Where("source_table = ? AND source_id = ?", record.SourceTable, record.SourceID).Take(&stored).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil {
			if stored.Actor != record.Actor {
				return errors.New("activity source belongs to a different actor")
			}
			record.ID, record.WorkID, record.ParentWorkID, record.WorkStartedAt, record.Attempt = stored.ID, stored.WorkID, stored.ParentWorkID, stored.WorkStartedAt, stored.Attempt
		}
		if err := r.storeDetail(tx, record); err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "source_table"}, {Name: "source_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"username",
				"type",
				"category",
				"action",
				"status",
				"server_id",
				"server_name",
				"title",
				"resource",
				"source",
				"ip",
				"user_agent",
				"started_at", "established_at", "connection_uncertain_until",
				"finished_at",
				"duration_ms",
				"progress",
				"total_count",
				"success_count",
				"failure_count",
				"bytes_total",
				"bytes_processed",
				"bytes_completed",
				"speed_bps",
				"error_message",
				"detail_json", "task_content_id", "task_content_size", "task_content_sha256", "detail_content_id", "detail_content_size", "detail_content_sha256",
				"updated_at",
			}),
		}).Create(record).Error; err != nil {
			return err
		}
		// Another writer may have inserted the same source after our initial read.
		// Never attach a body/resources to the losing ID or overwrite another actor.
		var committed OperationRecord
		if err := tx.Unscoped().Where("source_table=? AND source_id=?", record.SourceTable, record.SourceID).First(&committed).Error; err != nil {
			return err
		}
		if committed.Actor != record.Actor || committed.ID != record.ID {
			return errors.New("activity source identity changed")
		}
		record.WorkID, record.ParentWorkID, record.WorkStartedAt, record.Attempt = committed.WorkID, committed.ParentWorkID, committed.WorkStartedAt, committed.Attempt
		resources := append([]ResourceSnapshot(nil), record.Resources...)
		if record.ServerID != nil {
			resources = append(resources, ResourceSnapshot{ServerID: *record.ServerID, Name: record.ServerName})
		}
		for _, resource := range resources {
			if resource.ServerID == uuid.Nil {
				continue
			}
			row := Resource{RecordID: record.ID, ServerID: resource.ServerID, Name: resource.Name}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "record_id"}, {Name: "server_id"}}, DoUpdates: clause.Assignments(map[string]interface{}{"name": gorm.Expr("CASE WHEN operation_resources.name = '' THEN ? ELSE operation_resources.name END", resource.Name)})}).Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		record.ID, record.WorkID, record.ParentWorkID, record.WorkStartedAt, record.Attempt = candidate.ID, candidate.WorkID, candidate.ParentWorkID, candidate.WorkStartedAt, candidate.Attempt
		record.CreatedAt, record.UpdatedAt = candidate.CreatedAt, candidate.UpdatedAt
		record.Source, record.Category, record.BytesCompleted = candidate.Source, candidate.Category, candidate.BytesCompleted
	}
	return err
}

func (r *repository) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	if req == nil {
		req = &ListRequest{}
	}

	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx).Model(&OperationRecord{}))
	if err != nil {
		return nil, err
	}
	query = r.applyListFilters(query, req)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
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

	records := make([]*OperationRecordSummary, 0)
	err = query.
		Order(r.listOrder(req)).
		Limit(req.PageSize).
		Offset((req.Page - 1) * req.PageSize).
		Find(&records).Error
	if err != nil {
		return nil, err
	}

	totalPages := int(total) / req.PageSize
	if int(total)%req.PageSize > 0 {
		totalPages++
	}

	return &ListResponse{
		Records:    records,
		Total:      total,
		Page:       req.Page,
		PageSize:   req.PageSize,
		TotalPages: totalPages,
	}, nil
}

func (r *repository) GetByID(ctx context.Context, id uuid.UUID) (*OperationRecord, error) {
	var record OperationRecord
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	if err := query.Where("id = ?", id).First(&record).Error; err != nil {
		return nil, err
	}
	resources, err := readResourceSnapshots(r.db.WithContext(ctx), []uuid.UUID{record.ID})
	if err != nil {
		return nil, err
	}
	record.Resources = resources[record.ID]
	if record.TaskContentID != nil {
		ref := protocol.ContentReference{ID: *record.TaskContentID, Size: record.TaskContentSize, Sha256: record.TaskContentSHA256, MediaType: "application/json"}
		if err := contentstore.ValidateReference(ref); err != nil {
			return nil, err
		}
		record.TaskContent = &ref
	}
	if record.DetailContentID != nil {
		ref := protocol.ContentReference{ID: *record.DetailContentID, Size: record.DetailContentSize, Sha256: record.DetailContentSHA256, MediaType: "text/plain; charset=utf-8"}
		if err := contentstore.ValidateReference(ref); err != nil {
			return nil, err
		}
		record.DetailContent = &ref
	}
	return &record, nil
}

func (r *repository) GetStatistics(ctx context.Context, req *StatisticsRequest) (*Statistics, error) {
	stats := &Statistics{
		ByType:   make(map[RecordType]int64),
		ByStatus: make(map[Status]int64),
	}

	if req == nil {
		req = &StatisticsRequest{}
	}
	var rows []struct {
		Type   RecordType
		Status Status
		Count  int64
	}
	query, err := accessquery.Visible(ctx, r.statisticsQuery(ctx, req))
	if err != nil {
		return nil, err
	}
	if err := query.
		Select("type, status, count(*) as count").
		Group("type, status").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		stats.Total += row.Count
		stats.ByType[row.Type] += row.Count
		stats.ByStatus[row.Status] += row.Count
		switch row.Status {
		case StatusSuccess:
			stats.SuccessCount += row.Count
		case StatusFailure:
			stats.FailureCount += row.Count
		case StatusRunning:
			stats.RunningCount += row.Count
		}
	}

	return stats, nil
}

func (r *repository) applyListFilters(query *gorm.DB, req *ListRequest) *gorm.DB {
	if len(req.Types) > 0 {
		query = query.Where("type IN ?", req.Types)
	} else if req.Type != "" {
		query = query.Where("type = ?", req.Type)
	}
	if len(req.Categories) > 0 {
		query = query.Where("category IN ?", req.Categories)
	} else if req.Category != "" {
		query = query.Where("category = ?", req.Category)
	}
	if req.Action != "" {
		query = query.Where("action = ?", req.Action)
	}
	if len(req.Statuses) > 0 {
		query = query.Where("status IN ?", req.Statuses)
	} else if req.Status != "" {
		query = query.Where("status = ?", req.Status)
	}
	if req.ServerID != nil {
		query = query.Where("EXISTS (SELECT 1 FROM operation_resources ar WHERE ar.record_id = operation_records.id AND ar.server_id = ?)", *req.ServerID)
	}
	if req.Source != "" {
		query = query.Where("source = ?", req.Source)
	}
	if req.IP != "" {
		query = query.Where("ip = ?", req.IP)
	}
	if keyword := strings.TrimSpace(req.Keyword); keyword != "" {
		like := "%" + strings.ToLower(keyword) + "%"
		query = query.Where(
			"LOWER(username) LIKE ? OR LOWER(action) LIKE ? OR LOWER(status) LIKE ? OR LOWER(server_name) LIKE ? OR LOWER(title) LIKE ? OR LOWER(resource) LIKE ? OR LOWER(source) LIKE ? OR LOWER(ip) LIKE ? OR LOWER(error_message) LIKE ?",
			like, like, like, like, like, like, like, like, like,
		)
	}
	if req.StartTime != nil {
		query = query.Where("created_at >= ?", *req.StartTime)
	}
	if req.EndTime != nil {
		query = query.Where("created_at <= ?", *req.EndTime)
	}
	return query
}

func (r *repository) statisticsQuery(ctx context.Context, req *StatisticsRequest) *gorm.DB {
	query := r.db.WithContext(ctx).Model(&OperationRecord{})
	if req.Type != "" {
		query = query.Where("type = ?", req.Type)
	}
	if req.Category != "" {
		query = query.Where("category = ?", req.Category)
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

func (r *repository) listOrder(req *ListRequest) clause.OrderByColumn {
	sortBy := strings.ToLower(strings.TrimSpace(req.SortBy))
	column, ok := operationRecordSortColumns[sortBy]
	if !ok {
		column = "created_at"
	}

	return clause.OrderByColumn{
		Column: clause.Column{Name: column},
		Desc:   strings.ToLower(strings.TrimSpace(req.SortOrder)) != "asc",
	}
}

var operationRecordSortColumns = map[string]string{
	"created_at":      "created_at",
	"updated_at":      "updated_at",
	"started_at":      "started_at",
	"finished_at":     "finished_at",
	"username":        "username",
	"type":            "type",
	"category":        "category",
	"action":          "action",
	"status":          "status",
	"server_name":     "server_name",
	"resource":        "resource",
	"source":          "source",
	"ip":              "ip",
	"duration_ms":     "duration_ms",
	"progress":        "progress",
	"bytes_total":     "bytes_total",
	"bytes_processed": "bytes_processed",
}
