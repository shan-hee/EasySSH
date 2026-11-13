package rest

import (
	"net/http"

	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// AuditLogHandler 审计日志处理器
type AuditLogHandler struct {
	auditService auditlog.Service
}

// NewAuditLogHandler 创建审计日志处理器
func NewAuditLogHandler(auditService auditlog.Service) *AuditLogHandler {
	return &AuditLogHandler{
		auditService: auditService,
	}
}

// ListAll 查询全部日志列表（由 audit:view 策略授权）
// GET /api/v1/logs?page=1&page_size=20&category=activity
func (h *AuditLogHandler) ListAll(c *gin.Context) {
	req, ok := parseAuditLogListRequest(c)
	if !ok {
		return
	}

	logs, total, err := h.auditService.List(c.Request.Context(), req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	respondLogList(c, logs, total, req)
}

// GetAnyByID 获取单条日志（由 audit:view 策略授权）
// GET /api/v1/logs/:id
func (h *AuditLogHandler) GetAnyByID(c *gin.Context) {
	log, ok := h.getLogByID(c)
	if !ok {
		return
	}

	RespondSuccess(c, protocol.AuditLogDetail{
		ID: log.ID, Actor: log.Actor, Username: log.Username, ServerID: log.ServerID,
		Type: log.Type, Action: string(log.Action), Category: string(log.Category),
		Resource: log.Resource, Source: log.Source, Status: string(log.Status),
		IP: log.IP, UserAgent: log.UserAgent, Details: log.Details, DetailContent: log.DetailContent, TaskContent: log.TaskContent,
		ErrorMsg: log.ErrorMsg, Duration: log.Duration, CreatedAt: log.CreatedAt,
	})
}

// GetAllStatistics 获取全部日志统计（由 audit:view 策略授权）
// GET /api/v1/logs/statistics?days=30&category=activity
func (h *AuditLogHandler) GetAllStatistics(c *gin.Context) {
	req, ok := parseAuditLogStatisticsRequest(c)
	if !ok {
		return
	}

	stats, err := h.auditService.GetStatistics(c.Request.Context(), req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "statistics_failed", err.Error())
		return
	}

	RespondSuccess(c, stats)
}

func (h *AuditLogHandler) getLogByID(c *gin.Context) (*auditlog.AuditLog, bool) {
	logID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid log ID")
		return nil, false
	}

	log, err := h.auditService.GetByID(c.Request.Context(), logID)
	if err != nil {
		RespondError(c, http.StatusNotFound, "log_not_found", "Log not found")
		return nil, false
	}

	return log, true
}

func parseAuditLogListRequest(c *gin.Context) (*auditlog.ListAuditLogsRequest, bool) {
	req := &auditlog.ListAuditLogsRequest{}

	if serverIDStr := c.Query("server_id"); serverIDStr != "" {
		serverID, err := uuid.Parse(serverIDStr)
		if err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server_id")
			return nil, false
		}
		req.ServerID = &serverID
	}

	if action := c.Query("action"); action != "" {
		req.Action = auditlog.ActionType(action)
	}
	if values := splitQueryValues(c, "type"); len(values) > 0 {
		setQuerySelection(values, &req.Type, &req.Types)
	}
	if values := splitQueryValues(c, "category"); len(values) > 0 {
		setQuerySelection(values, &req.Category, &req.Categories)
	}
	if values := splitQueryValues(c, "status"); len(values) > 0 {
		setQuerySelection(values, &req.Status, &req.Statuses)
	}
	if source := c.Query("source"); source != "" {
		req.Source = source
	}
	if ip := c.Query("ip"); ip != "" {
		req.IP = ip
	}
	if keyword := firstNonEmptyQuery(c, "keyword", "q"); keyword != "" {
		req.Keyword = keyword
	}
	if sortBy := c.Query("sort_by"); sortBy != "" {
		req.SortBy = sortBy
	}
	if sortOrder := c.Query("sort_order"); sortOrder != "" {
		req.SortOrder = sortOrder
	}

	if startTime, ok := parseQueryTime(c, "start_date", false); !ok {
		return nil, false
	} else {
		req.StartTime = startTime
	}
	if endTime, ok := parseQueryTime(c, "end_date", true); !ok {
		return nil, false
	} else {
		req.EndTime = endTime
	}

	page, ok := parseBoundedQueryInt(c, "page", 1, 1, 1000000)
	if !ok {
		return nil, false
	}
	pageSize, ok := parseBoundedQueryInt(c, "page_size", 20, 1, 100)
	if !ok {
		return nil, false
	}
	req.Page, req.PageSize = page, pageSize

	if !validQueryTimeRange(c, req.StartTime, req.EndTime) {
		return nil, false
	}
	return req, true
}

func parseAuditLogStatisticsRequest(c *gin.Context) (*auditlog.AuditLogStatisticsRequest, bool) {
	req := &auditlog.AuditLogStatisticsRequest{}

	days, ok := parseBoundedQueryInt(c, "days", 30, 1, 365)
	if !ok {
		return nil, false
	}
	req.Days = days
	if category := c.Query("category"); category != "" {
		req.Category = auditlog.LogCategory(category)
	}

	if startTime, ok := parseQueryTime(c, "start_date", false); !ok {
		return nil, false
	} else {
		req.StartTime = startTime
	}
	if endTime, ok := parseQueryTime(c, "end_date", true); !ok {
		return nil, false
	} else {
		req.EndTime = endTime
	}

	if !validQueryTimeRange(c, req.StartTime, req.EndTime) {
		return nil, false
	}
	return req, true
}

func respondLogList(c *gin.Context, logs []*auditlog.AuditLogSummary, total int64, req *auditlog.ListAuditLogsRequest) {
	totalPages := int(total) / req.PageSize
	if int(total)%req.PageSize > 0 {
		totalPages++
	}

	RespondSuccess(c, protocol.AuditLogList{Logs: logs, Total: total, Page: req.Page, PageSize: req.PageSize, TotalPages: totalPages})
}
