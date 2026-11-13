package rest

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"strconv"
	"strings"

	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/taskprotocol"
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
	id, ok := taskCenterID(c)
	if !ok {
		return
	}
	run, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		RespondError(c, http.StatusNotFound, "task_run_not_found", err.Error())
		return
	}
	if !run.Retryable || run.DefinitionID == nil || h.scheduledTasks == nil {
		RespondError(c, http.StatusConflict, "task_not_retryable", "Task run cannot be retried")
		return
	}
	retryRunID, err := h.scheduledTasks.RetryTask(c.Request.Context(), *run.DefinitionID, run.ID, run.Attempt+1)
	if err != nil {
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
	c.JSON(http.StatusAccepted, protocol.TaskRetryResult{ID: retryRunID, DefinitionID: *run.DefinitionID, RetryOfID: run.ID})
}

func (h *TaskCenterHandler) List(c *gin.Context) {
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
		Statuses: statuses, TaskTypes: taskTypes, TriggerTypes: triggerTypes,
		Keyword: c.Query("keyword"), Page: page, PageSize: pageSize,
	})
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "list_task_runs_failed", err.Error())
		return
	}
	runs := make([]*protocol.TaskOverview, 0, len(result.Runs))
	for _, run := range result.Runs {
		if run != nil {
			value := taskprotocol.OverviewOf(run.Wire())
			runs = append(runs, &value)
		}
	}
	RespondSuccess(c, protocol.TaskRunList{Runs: runs, Total: result.Total, Page: result.Page, PageSize: result.PageSize, TotalPages: result.TotalPages})
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
	result, err := h.service.Statistics(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "task_statistics_failed", err.Error())
		return
	}
	RespondSuccess(c, result.Wire())
}

func (h *TaskCenterHandler) Get(c *gin.Context) {
	id, ok := taskCenterID(c)
	if !ok {
		return
	}
	detail, err := h.service.Details(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, taskcenter.ErrNotFound) {
			RespondError(c, http.StatusNotFound, "task_run_not_found", "Task run not found")
		} else {
			RespondError(c, http.StatusInternalServerError, "task_content_failed", "Cannot read task content")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	RespondSuccess(c, detail)
}

func (h *TaskCenterHandler) Events(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, ok := taskCenterID(c)
	if !ok {
		return
	}
	afterID, err := strconv.ParseUint(c.DefaultQuery("after_id", "0"), 10, 63)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_task_event_query", "Invalid event cursor")
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(taskprotocol.DefaultEventLimit)))
	if err != nil || limit < 1 || limit > taskprotocol.MaxEventLimit {
		RespondError(c, http.StatusBadRequest, "invalid_task_event_query", "Invalid event page size")
		return
	}
	result, err := h.service.Events(c.Request.Context(), id, protocol.TaskEventInput{AfterID: uint(afterID), Limit: limit})
	if err != nil {
		h.taskEventError(c, err)
		return
	}

	RespondSuccess(c, result)
}

func (h *TaskCenterHandler) Cancel(c *gin.Context) {
	id, ok := taskCenterID(c)
	if !ok {
		return
	}
	if err := h.service.RequestCancel(c.Request.Context(), id); err != nil {
		status := http.StatusConflict
		if err == taskcenter.ErrNotFound {
			status = http.StatusNotFound
		}
		RespondError(c, status, "task_cancel_failed", err.Error())
		return
	}
	run, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "task_cancel_status_failed", err.Error())
		return
	}
	RespondSuccess(c, protocol.TaskCancellation{ID: id, Status: run.Status})
}

func taskCenterID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil || id == uuid.Nil {
		RespondError(c, http.StatusBadRequest, "invalid_task_run_id", "Invalid task run ID")
		return uuid.Nil, false
	}
	return id, true
}
