package auditlog

import (
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
)

func auditLogToOperationRecord(log *AuditLog) *operationrecord.OperationRecord {
	if log.ID == uuid.Nil {
		log.ID = uuid.New()
	}
	if log.CreatedAt.IsZero() {
		log.CreatedAt = time.Now()
	}
	if log.Category == "" {
		log.Category = CategoryOf(log.Action)
	}

	status := operationrecord.Status(log.Status)
	if status == "" {
		status = operationrecord.StatusSuccess
	}
	recordType := operationrecord.RecordType(log.Type)
	if recordType == "" {
		recordType = operationrecord.TypeAudit
	}
	source := log.Source
	if source == "" {
		source = "api"
	}

	return &operationrecord.OperationRecord{
		ID:           log.ID,
		UserID:       log.UserID,
		Username:     log.Username,
		Type:         recordType,
		Category:     mapLogCategory(log.Category),
		Action:       string(log.Action),
		Status:       status,
		ServerID:     log.ServerID,
		Resource:     log.Resource,
		Source:       source,
		IP:           log.IP,
		UserAgent:    log.UserAgent,
		StartedAt:    &log.CreatedAt,
		FinishedAt:   &log.CreatedAt,
		DurationMs:   log.Duration,
		ErrorMessage: log.ErrorMsg,
		DetailJSON:   log.Details,
		SourceTable:  "audit_events",
		SourceID:     log.ID.String(),
		CreatedAt:    log.CreatedAt,
	}
}

func operationRecordToAuditLog(record *operationrecord.OperationRecord) *AuditLog {
	if record == nil {
		return nil
	}

	return &AuditLog{
		ID:        record.ID,
		UserID:    record.UserID,
		Username:  record.Username,
		ServerID:  record.ServerID,
		Type:      string(record.Type),
		Action:    ActionType(record.Action),
		Category:  unmapLogCategory(record.Category),
		Resource:  firstNonEmpty(record.Resource, record.Title, record.Source),
		Source:    record.Source,
		Status:    Status(record.Status),
		IP:        record.IP,
		UserAgent: record.UserAgent,
		Details:   record.DetailJSON,
		ErrorMsg:  record.ErrorMessage,
		Duration:  record.DurationMs,
		CreatedAt: record.CreatedAt,
	}
}

func operationRecordSummaryToAuditLogSummary(record *operationrecord.OperationRecordSummary) *AuditLogSummary {
	if record == nil {
		return nil
	}

	return &AuditLogSummary{
		ID:        record.ID,
		UserID:    record.UserID,
		Username:  record.Username,
		ServerID:  record.ServerID,
		Type:      string(record.Type),
		Action:    ActionType(record.Action),
		Category:  unmapLogCategory(record.Category),
		Resource:  firstNonEmpty(record.Resource, record.Title, record.Source),
		Source:    record.Source,
		Status:    Status(record.Status),
		IP:        record.IP,
		ErrorMsg:  record.ErrorMessage,
		Duration:  record.DurationMs,
		CreatedAt: record.CreatedAt,
	}
}

func auditListRequestToOperationRecordRequest(req *ListAuditLogsRequest) *operationrecord.ListRequest {
	if req == nil {
		req = &ListAuditLogsRequest{}
	}

	return &operationrecord.ListRequest{
		UserID:     req.UserID,
		Type:       operationrecord.RecordType(req.Type),
		Types:      mapLogTypes(req.Types),
		Category:   mapLogCategory(req.Category),
		Categories: mapLogCategories(req.Categories),
		Action:     string(req.Action),
		Status:     operationrecord.Status(req.Status),
		Statuses:   mapLogStatuses(req.Statuses),
		ServerID:   req.ServerID,
		Source:     req.Source,
		IP:         req.IP,
		Keyword:    req.Keyword,
		StartTime:  req.StartTime,
		EndTime:    req.EndTime,
		SortBy:     req.SortBy,
		SortOrder:  req.SortOrder,
		Page:       req.Page,
		PageSize:   req.PageSize,
	}
}

func mapLogTypes(types []string) []operationrecord.RecordType {
	if len(types) == 0 {
		return nil
	}

	recordTypes := make([]operationrecord.RecordType, 0, len(types))
	for _, typ := range types {
		recordTypes = append(recordTypes, operationrecord.RecordType(typ))
	}
	return recordTypes
}

func mapLogCategories(categories []LogCategory) []operationrecord.Category {
	if len(categories) == 0 {
		return nil
	}

	recordCategories := make([]operationrecord.Category, 0, len(categories))
	for _, category := range categories {
		if mapped := mapLogCategory(category); mapped != "" {
			recordCategories = append(recordCategories, mapped)
		}
	}
	return recordCategories
}

func mapLogStatuses(statuses []Status) []operationrecord.Status {
	if len(statuses) == 0 {
		return nil
	}

	recordStatuses := make([]operationrecord.Status, 0, len(statuses))
	for _, status := range statuses {
		recordStatuses = append(recordStatuses, operationrecord.Status(status))
	}
	return recordStatuses
}

func mapLogCategory(category LogCategory) operationrecord.Category {
	switch category {
	case CategoryActivity:
		return operationrecord.CategoryActivity
	case CategoryAudit:
		return operationrecord.CategoryAudit
	default:
		return ""
	}
}

func unmapLogCategory(category operationrecord.Category) LogCategory {
	switch category {
	case operationrecord.CategoryActivity:
		return CategoryActivity
	case operationrecord.CategoryAudit:
		return CategoryAudit
	default:
		return CategoryOf(ActionType(""))
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
