package rest

import (
	"errors"
	"net/http"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type OperationRecordHandler struct {
	service operationrecord.Service
}

func NewOperationRecordHandler(service operationrecord.Service) *OperationRecordHandler {
	return &OperationRecordHandler{service: service}
}

// List 查询当前用户操作记录
// GET /api/v1/operation-records?page=1&page_size=20&type=transfer
func (h *OperationRecordHandler) List(c *gin.Context) {

	req, ok := parseOperationRecordListRequest(c)
	if !ok {
		return
	}

	result, err := h.service.List(c.Request.Context(), req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	RespondSuccess(c, result)
}

// GetByID 获取当前用户操作记录详情
// GET /api/v1/operation-records/:id
func (h *OperationRecordHandler) GetByID(c *gin.Context) {

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid record ID")
		return
	}

	record, err := h.service.GetByID(c.Request.Context(), id)
	if err != nil {
		RespondError(c, http.StatusNotFound, "record_not_found", "Operation record not found")
		return
	}

	RespondSuccess(c, activityRecordResponse(record))
}

// GetStatistics 获取当前用户操作记录统计
// GET /api/v1/operation-records/statistics?days=30&type=connection
func (h *OperationRecordHandler) GetStatistics(c *gin.Context) {

	req, ok := parseOperationRecordStatisticsRequest(c)
	if !ok {
		return
	}

	stats, err := h.service.GetStatistics(c.Request.Context(), req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "statistics_failed", err.Error())
		return
	}

	RespondSuccess(c, stats)
}

func parseOperationRecordListRequest(c *gin.Context) (*operationrecord.ListRequest, bool) {
	req := &operationrecord.ListRequest{}

	if values := splitQueryValues(c, "type"); len(values) > 0 {
		setQuerySelection(values, &req.Type, &req.Types)
	}
	if values := splitQueryValues(c, "category"); len(values) > 0 {
		setQuerySelection(values, &req.Category, &req.Categories)
	}
	if action := c.Query("action"); action != "" {
		req.Action = action
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
	if serverIDStr := c.Query("server_id"); serverIDStr != "" {
		serverID, err := uuid.Parse(serverIDStr)
		if err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server_id")
			return nil, false
		}
		req.ServerID = &serverID
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

func parseOperationRecordStatisticsRequest(c *gin.Context) (*operationrecord.StatisticsRequest, bool) {
	req := &operationrecord.StatisticsRequest{}

	if typ := c.Query("type"); typ != "" {
		req.Type = operationrecord.RecordType(typ)
	}
	if category := c.Query("category"); category != "" {
		req.Category = operationrecord.Category(category)
	}
	days, ok := parseBoundedQueryInt(c, "days", 30, 1, 365)
	if !ok {
		return nil, false
	}
	req.Days = days
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

// Overview returns a snapshot-consistent activity page in the requested IANA timezone.
func (h *OperationRecordHandler) Overview(c *gin.Context) {
	var req operationrecord.OverviewRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_activity_query", err.Error())
		return
	}
	result, err := h.service.Overview(c.Request.Context(), req)
	if errors.Is(err, operationrecord.ErrInvalidWindow) {
		RespondError(c, http.StatusBadRequest, "invalid_activity_window", "Use today, seven_days or custom with inclusive local dates and an IANA timezone (at most one year)")
		return
	}
	if err != nil {
		accessError(c, err)
		return
	}
	RespondSuccess(c, activityOverviewResponse(result))
}
