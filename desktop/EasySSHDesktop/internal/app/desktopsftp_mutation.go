package app

import (
	"context"
	"encoding/json"
	"errors"
	"path"
	"strings"

	"github.com/easyssh/shared/sftputil"
)

// File mutations use the same durable executor records as transfers. The
// receipt describes an observed result; saving it never repeats remote work.
type DesktopSFTPChangeResult struct {
	TaskID string `json:"task_id"`
	Status string `json:"status"`
}

func (s *DesktopSFTPService) beginFileMutation(ctx context.Context, kind desktopSFTPTaskKind, serverID, remotePath string, size int64) (context.Context, string, context.CancelFunc, error) {
	if strings.TrimSpace(serverID) == "" {
		return nil, "", nil, errors.New("server id is required")
	}
	id, err := s.createTaskWithContext(ctx, kind, "", path.Base(remotePath), size, serverID, remotePath, "", 1)
	if err != nil {
		return nil, "", nil, err
	}
	bound, cancel := s.bindTaskContext(ctx, id)
	if err = s.startTask(id, "running", size); err != nil {
		s.failTask(id, desktopSFTPOperationError(bound, err))
		cancel()
		return nil, "", nil, err
	}
	return bound, id, cancel, nil
}

func (s *DesktopSFTPService) finishFileMutation(ctx context.Context, id string, err error, successes, failures int, processed, total int64, detail map[string]any) (DesktopSFTPChangeResult, error) {
	err = desktopSFTPOperationError(ctx, err)
	if errors.Is(err, errDesktopSFTPCommitUnknown) || errors.Is(err, errDesktopSFTPDeleteUnknown) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, errDesktopSFTPTaskCancelled) {
		// Unknown or canceled items are not confirmed failures. Batch callers
		// retain their already confirmed failures in the detailed per-path list.
		if _, batch := detail["failed_paths"]; !batch {
			failures = 0
		}
	}
	if err != nil {
		detail["error"] = err.Error()
	}
	s.recordSFTPTaskDetail(id, detail)
	s.taskMu.Lock()
	if task := s.tasks[id]; task != nil {
		task.Loaded, task.Total = processed, total
	}
	s.taskMu.Unlock()
	status := "succeeded"
	var saveErr error
	if err != nil {
		saveErr = s.failTaskOutcome(id, err, successes, failures, 0)
		switch {
		case errors.Is(err, errDesktopSFTPCommitUnknown), errors.Is(err, errDesktopSFTPDeleteUnknown):
			status = "unknown"
		case errors.Is(err, context.DeadlineExceeded):
			status = "timeout"
		case errors.Is(err, context.Canceled), errors.Is(err, errDesktopSFTPTaskCancelled):
			status = "canceled"
		case successes > 0:
			status = "partial_success"
		default:
			status = "failed"
		}
	} else {
		if failures > 0 {
			status = "failed"
			if successes > 0 {
				status = "partial_success"
			}
		}
		saveErr = s.completeTaskOutcome(id, status, "文件操作已结束", successes, failures)
	}
	result := DesktopSFTPChangeResult{TaskID: id, Status: status}
	return result, saveErr
}

func (s *DesktopSFTPService) recordSFTPTaskDetail(id string, detail map[string]any) {
	if id == "" {
		return
	}
	// All callers supply JSON-compatible operation metadata; file
	// contents, credentials and renderer-controlled arbitrary objects are absent.
	encoded, err := json.Marshal(detail)
	if err != nil {
		desktopLogPrintf("invalid SFTP task detail: %v", err)
		return
	}
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	if task := s.tasks[id]; task != nil && task.EndedAt == "" {
		task.detailJSON = string(encoded)
	}
}

func desktopSFTPMutationPath(value string) (string, error) {
	if value == "" || len(value) > 4096 {
		return "", errors.New("invalid file operation path")
	}
	for _, c := range value {
		if c == 0 {
			return "", errors.New("invalid file operation path")
		}
	}
	if !path.IsAbs(value) {
		return "", errors.New("file operation requires an absolute remote path")
	}
	return sftputil.NormalizePath(value), nil
}

// If the server's mutation response is missing, a cancellation does not prove
// that nothing happened. The user must inspect the target before retrying.
func desktopSFTPMutationError(err error) error {
	if err == nil || sftputil.DefiniteStatus(err) {
		return err
	}
	return errors.Join(errDesktopSFTPCommitUnknown, err)
}
