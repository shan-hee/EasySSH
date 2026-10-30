package rest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/resultstore"
	"github.com/easyssh/shared/sftputil"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Synchronous file mutations use the existing task source and activity projection.
// The payload contains paths/options only, never edited content or credentials.
func (h *SFTPHandler) beginFileMutation(c *gin.Context, serverID uuid.UUID, kind, resource string, total int, payload any) (*taskcenter.TaskRun, bool) {
	if h.taskRuns == nil {
		RespondError(c, http.StatusServiceUnavailable, "task_center_unavailable", "Task center is unavailable")
		return nil, false
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_file_operation", "Invalid file operation")
		return nil, false
	}
	id := uuid.New()
	run := &taskcenter.TaskRun{
		ID: id, SourceType: "sftp_operation", SourceID: id.String(), ServerID: &serverID,
		TaskType: kind, Title: map[string]string{"sftp_mkdir": "创建远端目录", "sftp_rename": "重命名远端文件", "sftp_chmod": "修改远端权限", "sftp_write": "保存远端文件", "sftp_delete_file": "删除远端文件", "sftp_batch_delete": "批量删除远端文件"}[kind], Resource: resource, PayloadJSON: string(encoded),
		TriggerType: taskcenter.TriggerManual, Runner: "server", Status: taskcenter.StatusQueued,
		TotalCount: total, Retryable: false, Cancelable: false,
	}
	if err := h.taskRuns.Create(c.Request.Context(), run); err != nil {
		accessError(c, err)
		return nil, false
	}
	c.Header("X-Task-ID", id.String())
	err = h.taskRuns.Start(c.Request.Context(), id, kind)
	if err == nil {
		var current *taskcenter.TaskRun
		current, err = h.taskRuns.Get(c.Request.Context(), id)
		if err == nil && current.Status != taskcenter.StatusRunning {
			err = taskcenter.ErrObservedOutcomeConflict
		}
	}
	if err != nil {
		h.finishFileMutation(c, *run, map[string]any{"attempted": false}, err, 0, 0)
		return nil, false
	}
	return run, true
}

func (h *SFTPHandler) finishFileMutation(c *gin.Context, run taskcenter.TaskRun, result any, operationErr error, successes, failures int) bool {
	status, code := taskcenter.StatusSucceeded, ""
	switch {
	case errors.Is(operationErr, sftputil.ErrMutationOutcomeUnknown):
		status, code = taskcenter.StatusUnknown, "file_outcome_unknown"
	case errors.Is(operationErr, context.DeadlineExceeded):
		status, code = taskcenter.StatusTimeout, "file_operation_timeout"
	case errors.Is(operationErr, context.Canceled):
		status, code = taskcenter.StatusCanceled, "file_operation_canceled"
	case operationErr != nil || failures > 0:
		status, code = taskcenter.StatusFailed, "file_operation_failed"
		if successes > 0 {
			status = taskcenter.StatusPartialSuccess
		}
	}
	message := ""
	if operationErr != nil {
		message = operationErr.Error()
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "file_result_unavailable", "Read the task record before repeating this operation")
		return false
	}
	finished := time.Now().UTC().Truncate(time.Millisecond)
	err = resultstore.Write(c.Request.Context(), func(ctx context.Context) error {
		err := h.taskRuns.CompleteExecution(ctx, run, status, string(encoded), code, message, successes, failures, finished)
		if errors.Is(err, taskcenter.ErrObservedOutcomeConflict) {
			return resultstore.Permanent(err)
		}
		return err
	})
	if err != nil {
		RespondError(c, http.StatusServiceUnavailable, "file_result_unavailable", "Operation result could not be saved; inspect the task and remote path before repeating it")
		return false
	}
	if operationErr != nil {
		if errors.Is(operationErr, sftputil.ErrMutationOutcomeUnknown) {
			RespondError(c, http.StatusConflict, code, "Remote effects are unknown; inspect the task and remote path before repeating the operation")
		} else if !respondSFTPAccessError(c, operationErr) {
			RespondError(c, http.StatusInternalServerError, code, message)
		}
		return false
	}
	return true
}

func (h *SFTPHandler) finishSingleFileMutation(c *gin.Context, run taskcenter.TaskRun, operationErr error) bool {
	successes, failures := 1, 0
	if operationErr != nil {
		successes, failures = 0, 1
		if errors.Is(operationErr, sftputil.ErrMutationOutcomeUnknown) || errors.Is(operationErr, context.Canceled) || errors.Is(operationErr, context.DeadlineExceeded) {
			failures = 0
		}
	}
	return h.finishFileMutation(c, run, map[string]any{"path": run.Resource, "completed": operationErr == nil}, operationErr, successes, failures)
}
