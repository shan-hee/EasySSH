package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

func (s *DesktopSFTPService) DownloadFile(input DesktopSFTPDownloadFileInput) error {
	return s.downloadSelection(input.ServerID, input.LocalPath, input.TaskID, []string{input.Path}, nil, false)
}

func (s *DesktopSFTPService) BatchDownload(input DesktopSFTPBatchDownloadInput) error {
	return s.downloadSelection(input.ServerID, input.LocalPath, input.TaskID, input.Paths, input.ExcludePatterns, true)
}

func (s *DesktopSFTPService) downloadSelection(serverID, localPath, taskID string, paths, patterns []string, archive bool) (err error) {
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return err
	}
	defer done()
	if !filepath.IsAbs(localPath) {
		return errors.New("absolute local destination is required")
	}
	selection, err := normalizeDesktopTransferSelection(paths, patterns, archive)
	if err != nil {
		return err
	}
	limits, err := s.GetTransferLimits()
	if err != nil {
		return err
	}
	intent := desktopTransferIntent{Kind: desktopSFTPTaskDownload, FileName: filepath.Base(localPath), SourceServerID: serverID, SourcePaths: selection.Paths, ExcludePatterns: selection.ExcludePatterns, Archive: selection.Archive, TargetPath: localPath, ResultPath: localPath}
	taskID, err = s.createTransferTask(ctx, taskID, 0, intent)
	if err != nil {
		return err
	}
	ctx, cancel := s.bindTaskContext(ctx, taskID)
	defer cancel()
	var plan desktopTransferPlan
	defer func() {
		err = desktopSFTPOperationError(ctx, err)
		format := "raw"
		if plan.archive {
			format = "zip"
		}
		s.recordSFTPTaskDetail(taskID, map[string]any{"source_paths": selection.Paths, "dest_path": localPath, "archive_format": format, "file_count": plan.files, "excluded_count": plan.excluded, "bytes_total": plan.bytes})
		if err != nil {
			err = errors.Join(err, s.failTask(taskID, err))
		} else {
			err = s.completeTaskOutcome(taskID, "succeeded", "Download completed", plan.files, 0)
		}
	}()
	if err = s.startTask(taskID, "downloading", 0); err != nil {
		return err
	}
	client, closeClient, err := s.openClientContext(ctx, serverID)
	if err != nil {
		return err
	}
	defer closeClient()
	plan, err = planDesktopTransfer(ctx, client, selection, limits)
	if err != nil {
		return err
	}
	if err = s.prepareTransferDestination(taskID, localPath, plan.bytes, plan.files); err != nil {
		return err
	}
	if err = s.updateTaskProgress(taskID, 0, plan.bytes, "stream"); err != nil {
		return err
	}
	return writeDesktopLocalAtomic(ctx, localPath, func(file *os.File) error {
		return writeDesktopTransferArchive(ctx, client, plan, file, func(processed int64) error { return s.updateTaskProgress(taskID, processed, plan.bytes, "stream") })
	})
}
