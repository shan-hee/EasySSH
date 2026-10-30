package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/easyssh/shared/sftputil"
	"github.com/pkg/sftp"
)

var errDesktopSFTPDeleteUnknown = sftputil.ErrMutationOutcomeUnknown

type DesktopSFTPDeleteEffects = sftputil.DeleteReport

func removeDesktopSFTPEntry(ctx context.Context, client *sftp.Client, remotePath string, info os.FileInfo, effects *DesktopSFTPDeleteEffects) error {
	return desktopSFTPOperationError(ctx, sftputil.DeleteEntry(ctx, client, remotePath, info, effects, nil))
}

func (s *DesktopSFTPService) deletionObserver(taskID string) sftputil.DeleteObserver {
	return func(receipt sftputil.DeleteReceipt) error {
		if s.taskCenter == nil || taskID == "" {
			return errors.New("task center is required to save deletion receipts")
		}
		data, err := json.Marshal(receipt)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		level := "info"
		if receipt.Outcome == "failed" || receipt.Outcome == "unknown" {
			level = "warning"
		}
		return s.taskCenter.appendObservation(ctx, taskID, level, "文件删除回执", string(data))
	}
}

// The same loop serves flat and recursive deletion. A context stop or unknown
// mutation ends the batch; paths not visited afterwards are not failed items.
func (s *DesktopSFTPService) deletePathsOnClient(ctx context.Context, client sftputil.DeleteFS, paths []string, recursive bool, taskID string) (DesktopSFTPBatchDeleteResult, error) {
	result := DesktopSFTPBatchDeleteResult{Success: []string{}, Failed: []DesktopSFTPBatchOperationError{}, Total: len(paths)}
	for index, remotePath := range paths {
		if err := ctx.Err(); err != nil {
			return result, desktopSFTPOperationError(ctx, err)
		}
		if taskID != "" && s.isTaskCancelled(taskID) {
			return result, errDesktopSFTPTaskCancelled
		}
		var err error
		if recursive {
			err = sftputil.DeleteTree(ctx, client, remotePath, &result.Effects, s.deletionObserver(taskID))
		} else {
			var info os.FileInfo
			info, err = client.Lstat(remotePath)
			if ctx.Err() != nil {
				return result, desktopSFTPOperationError(ctx, ctx.Err())
			}
			if err == nil {
				if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
					err = errors.New("directory deletion must use DeletePaths")
				} else {
					err = sftputil.DeleteEntry(ctx, client, remotePath, info, &result.Effects, nil)
				}
			}
		}
		err = desktopSFTPOperationError(ctx, err)
		if errors.Is(err, errDesktopSFTPTaskCancelled) || errors.Is(err, errDesktopSFTPDeleteUnknown) || errors.Is(err, sftputil.ErrDeleteLimit) || errors.Is(err, sftputil.ErrDeleteReceipt) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return result, err
		}
		if err != nil {
			result.Failed = append(result.Failed, desktopSFTPBatchError(remotePath, err))
		} else {
			result.Success = append(result.Success, remotePath)
		}
		if index+1 < len(paths) && taskID != "" && s.taskCenter != nil {
			if err := s.taskCenter.updateProgress(taskID, (index+1)*100/len(paths), "sftp_delete", 0, 0, len(result.Success), len(result.Failed)); err != nil {
				// A storage timeout is not an execution timeout. Stop later work,
				// retaining the already observed paths for final settlement.
				return result, fmt.Errorf("delete progress could not be saved: %v", err)
			}
		}
	}
	return result, nil
}

func desktopSFTPDeleteDetails(paths []string, result DesktopSFTPBatchDeleteResult, operationErr error) map[string]any {
	settled := make(map[string]bool, len(result.Success)+len(result.Failed))
	for _, value := range result.Success {
		settled[value] = true
	}
	for _, failure := range result.Failed {
		settled[failure.Path] = true
	}
	unresolved := []string{}
	for _, value := range paths {
		if !settled[value] {
			unresolved = append(unresolved, value)
		}
	}
	detail := map[string]any{"source_paths": paths, "file_count": len(paths), "effects": result.Effects, "success": len(result.Success), "failed": len(result.Failed), "success_paths": result.Success, "failed_paths": result.Failed, "unresolved_paths": unresolved}
	if operationErr != nil {
		detail["error"] = operationErr.Error()
	}
	return detail
}
