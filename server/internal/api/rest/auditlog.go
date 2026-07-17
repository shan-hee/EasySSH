package rest

import (
	"net/http"
	"strconv"

	"github.com/easyssh/server/internal/domain/auditlog"
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
	req, ok := parseAuditLogListRequest(c, true)
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

	RespondSuccess(c, log)
}

// GetAllStatistics 获取全部日志统计（由 audit:view 策略授权）
// GET /api/v1/logs/statistics?days=30&category=activity
func (h *AuditLogHandler) GetAllStatistics(c *gin.Context) {
	req, ok := parseAuditLogStatisticsRequest(c, true)
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

// CleanupOldLogs 清理旧日志（由 audit:view 策略授权）
// DELETE /api/v1/logs/cleanup?retention_days=90
func (h *AuditLogHandler) CleanupOldLogs(c *gin.Context) {
	retentionStr := c.DefaultQuery("retention_days", "90")
	retentionDays, err := strconv.Atoi(retentionStr)
	if err != nil || retentionDays <= 0 {
		retentionDays = 90
	}
	if retentionDays > 3650 {
		RespondError(c, http.StatusBadRequest, "invalid_retention_days", "Retention days must be between 1 and 3650")
		return
	}

	deletedCount, err := h.auditService.CleanupOldLogs(c.Request.Context(), retentionDays)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "cleanup_failed", err.Error())
		return
	}

	RespondSuccessWithMessage(c, gin.H{
		"deleted_count":  deletedCount,
		"retention_days": retentionDays,
	}, "Old logs cleaned up successfully")
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

func parseAuditLogListRequest(c *gin.Context, allowUserID bool) (*auditlog.ListAuditLogsRequest, bool) {
	req := &auditlog.ListAuditLogsRequest{}

	if userIDStr := c.Query("user_id"); allowUserID && userIDStr != "" {
		userID, err := uuid.Parse(userIDStr)
		if err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_user_id", "Invalid user_id")
			return nil, false
		}
		req.UserID = &userID
	}

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

	if pageStr := c.DefaultQuery("page", "1"); pageStr != "" {
		if page, err := strconv.Atoi(pageStr); err == nil {
			req.Page = page
		}
	}
	if pageSizeStr := c.DefaultQuery("page_size", "20"); pageSizeStr != "" {
		if pageSize, err := strconv.Atoi(pageSizeStr); err == nil {
			req.PageSize = pageSize
		}
	}

	return req, true
}

func parseAuditLogStatisticsRequest(c *gin.Context, allowUserID bool) (*auditlog.AuditLogStatisticsRequest, bool) {
	req := &auditlog.AuditLogStatisticsRequest{}

	if userIDStr := c.Query("user_id"); allowUserID && userIDStr != "" {
		userID, err := uuid.Parse(userIDStr)
		if err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_user_id", "Invalid user_id")
			return nil, false
		}
		req.UserID = &userID
	}

	daysStr := c.DefaultQuery("days", "30")
	if days, err := strconv.Atoi(daysStr); err == nil {
		req.Days = days
	}
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

	return req, true
}

func respondLogList(c *gin.Context, logs []*auditlog.AuditLog, total int64, req *auditlog.ListAuditLogsRequest) {
	if req.Page < 1 {
		req.Page = 1
	}
	if req.PageSize < 1 {
		req.PageSize = 20
	}
	totalPages := int(total) / req.PageSize
	if int(total)%req.PageSize > 0 {
		totalPages++
	}

	RespondSuccess(c, gin.H{
		"logs":        logs,
		"total":       total,
		"page":        req.Page,
		"page_size":   req.PageSize,
		"total_pages": totalPages,
	})
}
