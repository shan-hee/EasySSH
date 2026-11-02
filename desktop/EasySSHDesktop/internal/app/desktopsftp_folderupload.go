package app

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/easyssh/shared/sftputil"
)

// Folder bundles arrive through the loopback gateway like single files. The
// task counts bundle bytes, so its progress matches the request body.
func (s *DesktopSFTPService) uploadFolderStream(parent context.Context, serverID, remoteDir, folderName, requestedTaskID string, merge bool, size int64, source io.ReadCloser) (err error) {
	ctx, done, err := s.beginOperation(parent)
	if err != nil {
		return err
	}
	defer done()
	if err := ctx.Err(); err != nil {
		return err
	}
	target := sftputil.JoinPath(remoteDir, folderName)
	taskID, err := s.createTransferTask(ctx, requestedTaskID, size, desktopTransferIntent{Kind: desktopSFTPTaskUpload, FileName: folderName, TargetServerID: serverID, SourcePaths: []string{folderName}, TargetPath: target, ResultPath: target})
	if err != nil {
		return err
	}
	ctx, cancel := s.bindTaskContext(ctx, taskID)
	defer cancel()
	stop := sftputil.CloseOnCancel(ctx, source.Close)
	defer stop()
	var progress sftputil.FolderProgress
	defer func() {
		if errors.Is(err, sftputil.ErrMutationOutcomeUnknown) {
			err = fmt.Errorf("%w: %s", errDesktopSFTPCommitUnknown, err.Error())
		}
		err = desktopSFTPOperationError(ctx, err)
		if err == nil {
			err = s.completeTaskOutcome(taskID, "succeeded", "Upload completed", progress.Files, 0)
			return
		}
		failures := 1
		if errors.Is(err, context.Canceled) || errors.Is(err, errDesktopSFTPTaskCancelled) || errors.Is(err, errDesktopSFTPCommitUnknown) {
			failures = 0
		}
		err = errors.Join(err, s.failTaskOutcome(taskID, err, progress.Files, failures, progress.Bytes))
	}()
	limits, err := s.GetTransferLimits()
	if err != nil {
		return err
	}
	manifest, headerSize, contentSize, err := sftputil.ReadFolderBundleHeader(source, sftputil.FolderLimits{MaxEntries: limits.MaxEntries, MaxDepth: limits.MaxDepth})
	if err != nil {
		return err
	}
	if headerSize+contentSize != size {
		return errors.New("folder bundle does not match content length")
	}
	if err := s.startTask(taskID, "uploading", size); err != nil {
		return err
	}
	if err := s.prepareTransferDestination(taskID, target, size, len(manifest.Files)); err != nil {
		return err
	}
	client, closeClient, err := s.openClientContext(ctx, serverID)
	if err != nil {
		return err
	}
	defer closeClient()
	err = sftputil.WriteFolder(ctx, client, manifest, source, sftputil.FolderWrite{Target: target, Merge: merge, Progress: func(current sftputil.FolderProgress) error {
		committed := current.Files != progress.Files
		progress = current
		if err := s.updateTaskProgress(taskID, headerSize+current.Written, size, "stream"); err != nil {
			return err
		}
		if committed {
			return s.recordTransferCommit(taskID, desktopSFTPTransferStats{FilesCopied: current.Files, BytesCopied: current.Bytes})
		}
		return nil
	}})
	if err == nil {
		progress.Files, progress.Bytes = len(manifest.Files), contentSize
	}
	return err
}
