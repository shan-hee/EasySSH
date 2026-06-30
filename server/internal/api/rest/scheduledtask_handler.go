package rest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ScheduledTaskHandler 定时任务处理器
type ScheduledTaskHandler struct {
	scheduledTaskService scheduledtask.Service
	transferJobService   transferjob.Service
}

// NewScheduledTaskHandler 创建定时任务处理器实例
func NewScheduledTaskHandler(scheduledTaskService scheduledtask.Service) *ScheduledTaskHandler {
	return &ScheduledTaskHandler{
		scheduledTaskService: scheduledTaskService,
	}
}

// SetTransferJobService 注入后台传输服务，用于清理定时上传的暂存文件。
func (h *ScheduledTaskHandler) SetTransferJobService(service transferjob.Service) {
	h.transferJobService = service
}

// Create 创建定时任务
func (h *ScheduledTaskHandler) Create(c *gin.Context) {
	var req scheduledtask.CreateScheduledTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	if err := h.validateScheduledTransferTask(c.Request.Context(), uid, uuid.Nil, req.TaskType, req.PayloadJSON); err != nil {
		respondTransferJobError(c, err)
		return
	}

	task, err := h.scheduledTaskService.CreateScheduledTask(uid, &req)
	if err != nil {
		if err == scheduledtask.ErrInvalidCronExpression {
			RespondError(c, http.StatusBadRequest, "invalid_cron_expression", err.Error())
			return
		}
		RespondError(c, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	if err := h.bindStagedTransferJob(c.Request.Context(), uid, task); err != nil {
		_ = h.scheduledTaskService.DeleteScheduledTask(uid, task.ID)
		respondTransferJobError(c, err)
		return
	}

	RespondSuccess(c, task)
}

// List 获取定时任务列表
func (h *ScheduledTaskHandler) List(c *gin.Context) {
	var req scheduledtask.ListScheduledTasksRequest

	// 解析查询参数
	if err := c.ShouldBindQuery(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	response, err := h.scheduledTaskService.ListScheduledTasks(uid, &req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}

	RespondSuccess(c, response)
}

// GetByID 获取定时任务详情
func (h *ScheduledTaskHandler) GetByID(c *gin.Context) {
	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid task ID format")
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	task, err := h.scheduledTaskService.GetScheduledTask(uid, id)
	if err != nil {
		if err == scheduledtask.ErrScheduledTaskNotFound {
			RespondError(c, http.StatusNotFound, "not_found", "Scheduled task not found")
			return
		}
		if err == scheduledtask.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
			return
		}
		RespondError(c, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}

	RespondSuccess(c, task)
}

// Update 更新定时任务
func (h *ScheduledTaskHandler) Update(c *gin.Context) {
	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid task ID format")
		return
	}

	var req scheduledtask.UpdateScheduledTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	existingTask, err := h.scheduledTaskService.GetScheduledTask(uid, id)
	if err != nil {
		if err == scheduledtask.ErrScheduledTaskNotFound {
			RespondError(c, http.StatusNotFound, "not_found", "Scheduled task not found")
			return
		}
		if err == scheduledtask.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
			return
		}
		RespondError(c, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}

	taskType := existingTask.TaskType
	if req.TaskType != "" {
		taskType = req.TaskType
	}
	payloadJSON := existingTask.PayloadJSON
	if req.PayloadJSON != "" {
		payloadJSON = req.PayloadJSON
	}
	if err := h.validateScheduledTransferTask(c.Request.Context(), uid, id, taskType, payloadJSON); err != nil {
		respondTransferJobError(c, err)
		return
	}

	preboundID, detachPreboundOnFailure, err := h.prebindUpdatedStagedTransferJob(c.Request.Context(), uid, id, existingTask, taskType, payloadJSON)
	if err != nil {
		respondTransferJobError(c, err)
		return
	}

	task, err := h.scheduledTaskService.UpdateScheduledTask(uid, id, &req)
	if err != nil {
		if detachPreboundOnFailure {
			h.detachStagedTransferJob(c.Request.Context(), uid, preboundID)
		}
		if err == scheduledtask.ErrScheduledTaskNotFound {
			RespondError(c, http.StatusNotFound, "not_found", "Scheduled task not found")
			return
		}
		if err == scheduledtask.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
			return
		}
		if err == scheduledtask.ErrInvalidCronExpression {
			RespondError(c, http.StatusBadRequest, "invalid_cron_expression", err.Error())
			return
		}
		RespondError(c, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	h.cleanupReplacedStagedTransferJob(c.Request.Context(), uid, existingTask, task)

	RespondSuccess(c, task)
}

// Delete 删除定时任务
func (h *ScheduledTaskHandler) Delete(c *gin.Context) {
	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid task ID format")
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	task, err := h.scheduledTaskService.GetScheduledTask(uid, id)
	if err != nil {
		if err == scheduledtask.ErrScheduledTaskNotFound {
			RespondError(c, http.StatusNotFound, "not_found", "Scheduled task not found")
			return
		}
		if err == scheduledtask.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
			return
		}
		RespondError(c, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}

	if err := h.scheduledTaskService.DeleteScheduledTask(uid, id); err != nil {
		if err == scheduledtask.ErrScheduledTaskNotFound {
			RespondError(c, http.StatusNotFound, "not_found", "Scheduled task not found")
			return
		}
		if err == scheduledtask.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
			return
		}
		RespondError(c, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	h.cleanupStagedTransferJob(c.Request.Context(), uid, task)

	RespondSuccess(c, gin.H{"message": "Scheduled task deleted successfully"})
}

type scheduledTransferPayload struct {
	StagedJobID string `json:"staged_job_id,omitempty"`
}

func stagedTransferJobID(task *scheduledtask.ScheduledTask) (uuid.UUID, bool) {
	if task == nil || task.TaskType != string(transferjob.JobKindSFTPUpload) || task.PayloadJSON == "" {
		return uuid.Nil, false
	}
	return stagedTransferJobIDFor(task.TaskType, task.PayloadJSON)
}

func stagedTransferJobIDFor(taskType string, payloadJSON string) (uuid.UUID, bool) {
	if taskType != string(transferjob.JobKindSFTPUpload) || payloadJSON == "" {
		return uuid.Nil, false
	}
	return stagedTransferJobIDFromPayload(payloadJSON)
}

func stagedTransferJobIDFromPayload(payloadJSON string) (uuid.UUID, bool) {
	if payloadJSON == "" {
		return uuid.Nil, false
	}
	var payload scheduledTransferPayload
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(payload.StagedJobID)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func (h *ScheduledTaskHandler) validateScheduledTransferTask(ctx context.Context, userID uuid.UUID, taskID uuid.UUID, taskType string, payloadJSON string) error {
	if taskType != string(transferjob.JobKindSFTPUpload) && taskType != string(transferjob.JobKindSFTPDownload) {
		return nil
	}
	if h.transferJobService == nil {
		return fmt.Errorf("%w: transfer job service is not initialized", transferjob.ErrInvalidJobRequest)
	}
	return h.transferJobService.ValidateScheduledTask(ctx, userID, taskID, taskType, payloadJSON)
}

func (h *ScheduledTaskHandler) cleanupReplacedStagedTransferJob(ctx context.Context, userID uuid.UUID, before, after *scheduledtask.ScheduledTask) {
	oldID, ok := stagedTransferJobID(before)
	if !ok {
		return
	}
	newID, hasNew := stagedTransferJobID(after)
	if hasNew && newID == oldID {
		return
	}
	h.deleteStagedTransferJob(ctx, userID, oldID, before.ID)
}

func (h *ScheduledTaskHandler) cleanupStagedTransferJob(ctx context.Context, userID uuid.UUID, task *scheduledtask.ScheduledTask) {
	id, ok := stagedTransferJobID(task)
	if !ok {
		return
	}
	h.deleteStagedTransferJob(ctx, userID, id, task.ID)
}

func (h *ScheduledTaskHandler) prebindUpdatedStagedTransferJob(
	ctx context.Context,
	userID uuid.UUID,
	taskID uuid.UUID,
	existingTask *scheduledtask.ScheduledTask,
	taskType string,
	payloadJSON string,
) (uuid.UUID, bool, error) {
	id, ok := stagedTransferJobIDFor(taskType, payloadJSON)
	if !ok {
		return uuid.Nil, false, nil
	}
	if err := h.bindStagedTransferPayload(ctx, userID, taskID, taskType, payloadJSON); err != nil {
		return uuid.Nil, false, err
	}
	oldID, hasOld := stagedTransferJobID(existingTask)
	shouldDetachOnFailure := !hasOld || oldID != id
	return id, shouldDetachOnFailure, nil
}

func (h *ScheduledTaskHandler) bindStagedTransferJob(ctx context.Context, userID uuid.UUID, task *scheduledtask.ScheduledTask) error {
	if task == nil {
		return nil
	}
	return h.bindStagedTransferPayload(ctx, userID, task.ID, task.TaskType, task.PayloadJSON)
}

func (h *ScheduledTaskHandler) bindStagedTransferPayload(ctx context.Context, userID uuid.UUID, taskID uuid.UUID, taskType string, payloadJSON string) error {
	if h.transferJobService == nil {
		return nil
	}
	id, ok := stagedTransferJobIDFor(taskType, payloadJSON)
	if !ok {
		return nil
	}
	if err := h.transferJobService.AttachScheduledTask(ctx, userID, id, taskID); err != nil {
		log.Printf("[ScheduledTask] bind staged transfer job failed: taskID=%s, jobID=%s, error=%v", taskID, id, err)
		return err
	}
	return nil
}

func (h *ScheduledTaskHandler) detachStagedTransferJob(ctx context.Context, userID uuid.UUID, id uuid.UUID) {
	if h.transferJobService == nil || id == uuid.Nil {
		return
	}
	if err := h.transferJobService.DetachScheduledTask(ctx, userID, id); err != nil && !errors.Is(err, transferjob.ErrJobNotFound) {
		log.Printf("[ScheduledTask] detach staged transfer job failed: jobID=%s, error=%v", id, err)
	}
}

func (h *ScheduledTaskHandler) deleteStagedTransferJob(ctx context.Context, userID uuid.UUID, id uuid.UUID, excludeTaskID uuid.UUID) {
	if h.transferJobService == nil || id == uuid.Nil {
		return
	}
	referenced, err := h.scheduledTaskService.IsStagedJobReferenced(userID, id, excludeTaskID)
	if err != nil {
		log.Printf("[ScheduledTask] check staged transfer references failed: jobID=%s, error=%v", id, err)
		return
	}
	if referenced {
		return
	}
	if err := h.transferJobService.DeleteScheduledInputJob(ctx, userID, id, excludeTaskID); err != nil && !errors.Is(err, transferjob.ErrJobNotFound) {
		log.Printf("[ScheduledTask] cleanup staged transfer job failed: jobID=%s, error=%v", id, err)
		if !errors.Is(err, transferjob.ErrArtifactInUse) {
			return
		}
		if detachErr := h.transferJobService.DetachScheduledTask(ctx, userID, id); detachErr != nil && !errors.Is(detachErr, transferjob.ErrJobNotFound) {
			log.Printf("[ScheduledTask] detach staged transfer job failed: jobID=%s, error=%v", id, detachErr)
		}
	}
}

// GetStatistics 获取定时任务统计信息
func (h *ScheduledTaskHandler) GetStatistics(c *gin.Context) {
	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	stats, err := h.scheduledTaskService.GetStatistics(uid)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "get_statistics_failed", err.Error())
		return
	}

	RespondSuccess(c, stats)
}

// Toggle 启用/禁用定时任务
func (h *ScheduledTaskHandler) Toggle(c *gin.Context) {
	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid task ID format")
		return
	}

	var req struct {
		Enabled *bool `json:"enabled" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	if err := h.scheduledTaskService.ToggleTask(uid, id, *req.Enabled); err != nil {
		if err == scheduledtask.ErrScheduledTaskNotFound {
			RespondError(c, http.StatusNotFound, "not_found", "Scheduled task not found")
			return
		}
		if err == scheduledtask.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
			return
		}
		RespondError(c, http.StatusInternalServerError, "toggle_failed", err.Error())
		return
	}

	RespondSuccess(c, gin.H{"message": "Task toggled successfully"})
}

// Trigger 手动触发定时任务
func (h *ScheduledTaskHandler) Trigger(c *gin.Context) {
	idParam := c.Param("id")
	id, err := uuid.Parse(idParam)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid task ID format")
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	if err := h.scheduledTaskService.TriggerTask(uid, id); err != nil {
		if err == scheduledtask.ErrScheduledTaskNotFound {
			RespondError(c, http.StatusNotFound, "not_found", "Scheduled task not found")
			return
		}
		if err == scheduledtask.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
			return
		}
		RespondError(c, http.StatusInternalServerError, "trigger_failed", err.Error())
		return
	}

	RespondSuccess(c, gin.H{"message": "Task triggered successfully"})
}
