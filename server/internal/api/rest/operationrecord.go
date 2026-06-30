package rest

import (
	"net/http"
	"strconv"

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
	currentUserID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	req, ok := parseOperationRecordListRequest(c)
	if !ok {
		return
	}
	applyOperationRecordUserScope(req, currentUserID)

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
	currentUserID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid record ID")
		return
	}

	record, err := h.service.GetByID(c.Request.Context(), id)
	if err != nil || record.UserID != currentUserID {
		RespondError(c, http.StatusNotFound, "record_not_found", "Operation record not found")
		return
	}

	RespondSuccess(c, record)
}

// GetStatistics 获取当前用户操作记录统计
// GET /api/v1/operation-records/statistics?days=30&type=connection
func (h *OperationRecordHandler) GetStatistics(c *gin.Context) {
	currentUserID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	req, ok := parseOperationRecordStatisticsRequest(c)
	if !ok {
		return
	}
	applyOperationRecordStatisticsUserScope(req, currentUserID)

	stats, err := h.service.GetStatistics(c.Request.Context(), req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "statistics_failed", err.Error())
		return
	}

	RespondSuccess(c, stats)
}

func parseOperationRecordListRequest(c *gin.Context) (*operationrecord.ListRequest, bool) {
	req := &operationrecord.ListRequest{}

	if userIDStr := c.Query("user_id"); userIDStr != "" {
		userID, err := uuid.Parse(userIDStr)
		if err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_user_id", "Invalid user_id")
			return nil, false
		}
		req.UserID = &userID
	}
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

	if page, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil {
		req.Page = page
	}
	if pageSize, err := strconv.Atoi(c.DefaultQuery("page_size", "20")); err == nil {
		req.PageSize = pageSize
	}

	return req, true
}

func parseOperationRecordStatisticsRequest(c *gin.Context) (*operationrecord.StatisticsRequest, bool) {
	req := &operationrecord.StatisticsRequest{}

	if userIDStr := c.Query("user_id"); userIDStr != "" {
		userID, err := uuid.Parse(userIDStr)
		if err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_user_id", "Invalid user_id")
			return nil, false
		}
		req.UserID = &userID
	}
	if typ := c.Query("type"); typ != "" {
		req.Type = operationrecord.RecordType(typ)
	}
	if category := c.Query("category"); category != "" {
		req.Category = operationrecord.Category(category)
	}
	if days, err := strconv.Atoi(c.DefaultQuery("days", "30")); err == nil {
		req.Days = days
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

func applyOperationRecordUserScope(req *operationrecord.ListRequest, currentUserID uuid.UUID) {
	req.UserID = &currentUserID
}

func applyOperationRecordStatisticsUserScope(req *operationrecord.StatisticsRequest, currentUserID uuid.UUID) {
	req.UserID = &currentUserID
}
