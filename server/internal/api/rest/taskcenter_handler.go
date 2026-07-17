package rest

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type TaskCenterHandler struct {
	service        taskcenter.Service
	scheduledTasks scheduledtask.Service
}

func NewTaskCenterHandler(service taskcenter.Service, scheduledTasks scheduledtask.Service) *TaskCenterHandler {
	return &TaskCenterHandler{service: service, scheduledTasks: scheduledTasks}
}

func (h *TaskCenterHandler) Retry(c *gin.Context) {
	userID, id, ok := taskCenterUserAndID(c)
	if !ok {
		return
	}
	run, err := h.service.Get(c.Request.Context(), userID, id)
	if err != nil {
		RespondError(c, http.StatusNotFound, "task_run_not_found", err.Error())
		return
	}
	if !run.Retryable || run.DefinitionID == nil || h.scheduledTasks == nil {
		RespondError(c, http.StatusConflict, "task_not_retryable", "Task run cannot be retried")
		return
	}
	if err := h.scheduledTasks.RetryTask(userID, *run.DefinitionID, run.ID, run.Attempt+1); err != nil {
		status := http.StatusInternalServerError
		code := "retry_task_failed"
		switch err {
		case scheduledtask.ErrScheduledTaskNotFound:
			status, code = http.StatusNotFound, "scheduled_task_not_found"
		case scheduledtask.ErrUnauthorized:
			status, code = http.StatusForbidden, "forbidden"
		case scheduledtask.ErrSchedulerNotInitialized:
			status, code = http.StatusServiceUnavailable, "scheduler_unavailable"
		}
		RespondError(c, status, code, err.Error())
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"definition_id": run.DefinitionID, "retry_of_id": run.ID})
}

func (h *TaskCenterHandler) List(c *gin.Context) {
	userID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	statuses := make([]taskcenter.Status, 0)
	for _, value := range splitTaskFilterValues(c.Query("status")) {
		statuses = append(statuses, taskcenter.Status(value))
	}
	taskTypes := splitTaskFilterValues(c.Query("task_type"))
	triggerTypes := make([]taskcenter.TriggerType, 0)
	for _, value := range splitTaskFilterValues(c.Query("trigger_type")) {
		triggerTypes = append(triggerTypes, taskcenter.TriggerType(value))
	}
	result, err := h.service.List(c.Request.Context(), &taskcenter.ListRequest{
		UserID: userID, Statuses: statuses, TaskTypes: taskTypes, TriggerTypes: triggerTypes,
		Keyword: c.Query("keyword"), Page: page, PageSize: pageSize,
	})
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "list_task_runs_failed", err.Error())
		return
	}
	RespondSuccess(c, result)
}

func splitTaskFilterValues(raw string) []string {
	values := make([]string, 0)
	seen := make(map[string]struct{})
	for _, value := range strings.Split(raw, ",") {
		if value = strings.TrimSpace(value); value != "" {
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			values = append(values, value)
		}
	}
	return values
}

func (h *TaskCenterHandler) Statistics(c *gin.Context) {
	userID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	result, err := h.service.Statistics(c.Request.Context(), userID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "task_statistics_failed", err.Error())
		return
	}
	RespondSuccess(c, result)
}

// Cleanup 删除当前用户保留期外的已结束任务运行记录。
func (h *TaskCenterHandler) Cleanup(c *gin.Context) {
	userID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	retentionDays, err := strconv.Atoi(c.DefaultQuery("retention_days", "90"))
	if err != nil || retentionDays < 1 || retentionDays > 3650 {
		RespondError(c, http.StatusBadRequest, "invalid_retention_days", "Retention days must be between 1 and 3650")
		return
	}
	result, err := h.service.Cleanup(c.Request.Context(), userID, retentionDays)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "cleanup_task_runs_failed", err.Error())
		return
	}
	RespondSuccessWithMessage(c, gin.H{
		"deleted_count":         result.DeletedCount,
		"deleted_events":        result.DeletedEvents,
		"deleted_notifications": result.DeletedNotifications,
		"retention_days":        retentionDays,
	}, "Old task runs cleaned up successfully")
}

func (h *TaskCenterHandler) Get(c *gin.Context) {
	userID, id, ok := taskCenterUserAndID(c)
	if !ok {
		return
	}
	run, err := h.service.Get(c.Request.Context(), userID, id)
	if err != nil {
		RespondError(c, http.StatusNotFound, "task_run_not_found", err.Error())
		return
	}
	events, err := h.service.Events(c.Request.Context(), userID, id)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "task_events_failed", err.Error())
		return
	}
	RespondSuccess(c, gin.H{"run": run, "events": events})
}

func (h *TaskCenterHandler) Cancel(c *gin.Context) {
	userID, id, ok := taskCenterUserAndID(c)
	if !ok {
		return
	}
	if err := h.service.RequestCancel(c.Request.Context(), userID, id); err != nil {
		status := http.StatusConflict
		if err == taskcenter.ErrNotFound {
			status = http.StatusNotFound
		}
		RespondError(c, status, "task_cancel_failed", err.Error())
		return
	}
	RespondSuccess(c, gin.H{"id": id, "status": taskcenter.StatusCanceling})
}

func taskCenterUserAndID(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
	userID, ok := requireCurrentUserID(c)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_task_run_id", "Invalid task run ID")
		return uuid.Nil, uuid.Nil, false
	}
	return userID, id, true
}
