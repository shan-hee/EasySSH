package rest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"log"
	"time"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
)

func (h *SFTPHandler) beginDelete(request context.Context, id uuid.UUID) (context.Context, func(), error) {
	h.deleteMu.Lock()
	defer h.deleteMu.Unlock()
	if h.deleteStopped {
		return nil, nil, errors.New("file service is stopping")
	}
	if len(h.deleteCancels) >= 4 {
		return nil, nil, errors.New("deletion capacity exhausted")
	}
	if err := request.Err(); err != nil {
		return nil, nil, err
	}
	if h.deleteCancels == nil {
		h.deleteCancels = make(map[uuid.UUID]context.CancelFunc)
	}
	if id == uuid.Nil || h.deleteCancels[id] != nil {
		return nil, nil, errors.New("invalid or duplicate deletion task")
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(request))
	h.deleteCancels[id] = cancel
	h.deleteWG.Add(1)
	return ctx, func() {
		cancel()
		h.deleteMu.Lock()
		delete(h.deleteCancels, id)
		h.deleteMu.Unlock()
		h.deleteWG.Done()
	}, nil
}

func (h *SFTPHandler) executeRecursiveDeleteTask(ctx context.Context, run taskcenter.TaskRun, serverID uuid.UUID, paths []string) {
	var report sftputil.DeleteReport
	success := make([]string, 0, len(paths))
	failed := make([]map[string]string, 0)
	var operationErr error
	attempted := 0
	var interrupted map[string]string
	settle := true
	var body *contentstore.Writer
	var releaseBody func()
	defer func() {
		if !settle {
			return
		}
		status := taskcenter.StatusSucceeded
		code, message := "", ""
		switch {
		case errors.Is(operationErr, sftputil.ErrMutationOutcomeUnknown):
			status, code = taskcenter.StatusUnknown, "delete_outcome_unknown"
		case errors.Is(operationErr, context.DeadlineExceeded):
			status, code = taskcenter.StatusTimeout, "delete_timeout"
		case errors.Is(operationErr, context.Canceled):
			status, code = taskcenter.StatusCanceled, "delete_canceled"
		case operationErr != nil || len(failed) > 0:
			status, code = taskcenter.StatusFailed, "delete_failed"
			if len(success) > 0 || report.FilesRemoved+report.DirectoriesRemoved > 0 {
				status, code = taskcenter.StatusPartialSuccess, "partial_delete_failed"
			}
		}
		if operationErr != nil {
			message = operationErr.Error()
		} else if len(failed) > 0 {
			message = "部分路径未能删除，详情包含已确认的子项结果"
		}
		var bodyRef *protocol.ContentReference
		if body != nil {
			defer releaseBody()
			ref, err := body.Finish()
			if err != nil {
				log.Printf("[SFTP] seal deletion body: task=%s error=%v", run.ID, err)
				return
			}
			if err := h.contents.Seal(ctx, ref); err != nil {
				log.Printf("[SFTP] save deletion body metadata: task=%s error=%v", run.ID, err)
				return
			}
			bodyRef = &ref
		}
		result, _ := json.Marshal(map[string]any{"strategy": "sftp_recursive", "success": success, "failed": failed, "effects": report, "total": len(paths), "unprocessed": len(paths) - attempted, "interrupted": interrupted, "items_content": bodyRef})
		finished := time.Now().UTC().Truncate(time.Millisecond)
		err := resultstore.Write(ctx, func(attempt context.Context) error {
			err := h.taskRuns.CompleteExecution(attempt, run, status, string(result), code, message, len(success), len(failed), finished)
			if errors.Is(err, taskcenter.ErrObservedOutcomeConflict) {
				return resultstore.Permanent(err)
			}
			return err
		})
		if err != nil {
			log.Printf("[SFTP] save deletion result: task=%s error=%v", run.ID, err)
		}
	}()

	operationErr = h.taskRuns.Start(ctx, run.ID, "sftp_recursive")
	if operationErr != nil {
		return
	}
	// Start can return nil for an already terminal record. Never treat that as
	// permission to execute a task again.
	current, err := h.taskRuns.Get(ctx, run.ID)
	if err != nil {
		operationErr = err
		return
	}
	if current.Status == taskcenter.StatusCanceling {
		operationErr = context.Canceled
		return
	}
	if current.Status != taskcenter.StatusRunning {
		settle = false // another source already settled it; no remote work occurred
		return
	}
	if h.contents == nil {
		operationErr = errors.New("content storage is unavailable")
		return
	}
	body, releaseBody, err = h.contents.BeginTask(ctx, run.ID, run, protocol.FilesDelete, "application/x-ndjson")
	if err != nil {
		operationErr = err
		return
	}
	client, err := h.pool.Get(ctx, serverID, protocol.FilesDelete)
	if err != nil {
		operationErr = err
		return
	}
	defer client.Release()
	encoder := json.NewEncoder(body)
	observe := func(receipt sftputil.DeleteReceipt) error { return encoder.Encode(receipt) }
	for index, remotePath := range paths {
		attempted++
		err := client.DeleteTree(remotePath, &report, observe)
		if err != nil {
			if errors.Is(err, sftputil.ErrMutationOutcomeUnknown) || errors.Is(err, sftputil.ErrDeleteLimit) || errors.Is(err, sftputil.ErrDeleteReceipt) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
				interrupted = map[string]string{"path": remotePath, "error": err.Error()}
				operationErr = err
				return
			}
			failed = append(failed, map[string]string{"path": remotePath, "error": err.Error()})
		} else {
			success = append(success, remotePath)
		}
		if index == len(paths)-1 {
			break // final completion atomically saves the final progress and receipts
		}
		progress, _ := json.Marshal(map[string]any{"current_path": remotePath, "completed": index + 1, "total": len(paths), "files_removed": report.FilesRemoved, "directories_removed": report.DirectoriesRemoved, "bytes_removed": report.BytesRemoved})
		saveCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err = h.taskRuns.UpdateProgress(saveCtx, run.ID, (index+1)*100/len(paths), "sftp_recursive", string(progress), len(success), len(failed))
		cancel()
		if err != nil {
			operationErr = fmt.Errorf("delete progress could not be saved: %w", err)
			return
		}
	}
}

func (h *SFTPHandler) stopDeletes() {
	h.deleteMu.Lock()
	h.deleteStopped = true
	for _, cancel := range h.deleteCancels {
		cancel()
	}
	h.deleteMu.Unlock()
	h.deleteWG.Wait()
}

// Cancellation stops later I/O; the executor still records observed outcomes.
func (h *SFTPHandler) CancelDeleteTask(ctx context.Context, id uuid.UUID) error {
	h.deleteMu.Lock()
	if cancel := h.deleteCancels[id]; cancel != nil {
		cancel()
		h.deleteMu.Unlock()
		return nil
	}
	h.deleteMu.Unlock()
	// The worker may have saved cancellation and exited between the database
	// transition and this callback. A committed cancellation is already done.
	run, err := h.taskRuns.Get(ctx, id)
	if err != nil {
		return err
	}
	if run.SourceType == "sftp_delete" && run.Status == taskcenter.StatusCanceled {
		return nil
	}
	return taskcenter.ErrNotCancelable
}
