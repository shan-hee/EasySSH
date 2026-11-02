package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
	"github.com/pkg/sftp"
)

type DesktopSFTPLocalUploadInput struct {
	ServerID  string `json:"serverId"`
	Path      string `json:"path"`
	LocalPath string `json:"localPath"`
	FileName  string `json:"fileName,omitempty"`
	TaskID    string `json:"taskId,omitempty"`
}

// Owner-only native binding. The owner's native file dialog supplies LocalPath;
// sharing windows cannot invoke this service or access this local-path API.
// File bytes stay in Go and the operation returns before the transfer finishes.
func (s *DesktopSFTPService) StartLocalUpload(input DesktopSFTPLocalUploadInput) (protocol.TransferJob, error) {
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return protocol.TransferJob{}, err
	}
	launched := false
	defer func() {
		if !launched {
			done()
		}
	}()
	if input.LocalPath == "" || !filepath.IsAbs(input.LocalPath) {
		return protocol.TransferJob{}, errors.New("absolute local path is required")
	}
	before, err := os.Lstat(input.LocalPath)
	if err != nil || !before.Mode().IsRegular() {
		return protocol.TransferJob{}, errors.New("local source is not a regular file")
	}
	file, err := os.Open(input.LocalPath)
	if err != nil {
		return protocol.TransferJob{}, err
	}
	defer func() {
		if !launched {
			_ = file.Close()
		}
	}()
	if !sameDesktopUploadFile(file, before) {
		return protocol.TransferJob{}, errors.New("local source changed")
	}
	fileName := input.FileName
	if fileName == "" {
		fileName = filepath.Base(input.LocalPath)
	}
	if fileName == "." || fileName == ".." || strings.ContainsAny(fileName, "/\x00") {
		return protocol.TransferJob{}, errors.New("file name must be a single path component")
	}
	remotePath := sftputil.JoinPath(input.Path, fileName)
	taskID, err := s.createTransferTask(ctx, input.TaskID, before.Size(), desktopTransferIntent{Kind: desktopSFTPTaskUpload, FileName: fileName, TargetServerID: input.ServerID, SourcePaths: []string{input.LocalPath}, TargetPath: remotePath, ResultPath: remotePath})
	if err != nil {
		return protocol.TransferJob{}, err
	}
	ctx, cancel := s.bindTaskContext(ctx, taskID)
	launched = true
	go func() {
		defer done()
		defer cancel()
		defer file.Close()
		stop := sftputil.CloseOnCancel(ctx, file.Close)
		defer stop()
		err := s.uploadLocalFile(ctx, taskID, input.ServerID, remotePath, file, before)
		err = desktopSFTPOperationError(ctx, err)
		if err != nil {
			s.failTask(taskID, err)
		} else {
			s.completeTask(taskID, "Upload completed")
		}
	}()
	return s.GetTransfer(taskID)
}

func (s *DesktopSFTPService) uploadLocalFile(ctx context.Context, taskID, serverID, remotePath string, source *os.File, snapshot os.FileInfo) error {
	_, err := s.writeUploadStream(ctx, taskID, serverID, remotePath, io.NewSectionReader(source, 0, snapshot.Size()), snapshot.Size(), func() error {
		if !sameDesktopUploadFile(source, snapshot) {
			return errors.New("local source changed during transfer")
		}
		return nil
	})
	return err
}

// Local-path and renderer uploads share bounded streaming, progress and atomic
// replacement. Validate the local snapshot before reading and before committing.
func (s *DesktopSFTPService) writeUploadStream(ctx context.Context, taskID, serverID, remotePath string, source io.Reader, size int64, validate func() error) (DesktopSFTPFileInfo, error) {
	if err := s.startTask(taskID, "uploading", size); err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	client, closeClient, err := s.openClientContext(ctx, serverID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closeClient()
	return writeDesktopSFTPAtomic(ctx, client, remotePath, 0600, func(file *sftp.File) error {
		if validate != nil {
			if err := validate(); err != nil {
				return err
			}
		}
		writer := newDesktopSFTPProgressWriter(file, size, func(loaded, total int64) error {
			return s.updateTaskProgress(taskID, loaded, total, "stream")
		})
		if _, err := io.CopyN(writer, source, size); err != nil {
			return err
		}
		var extra [1]byte
		if _, err := io.ReadFull(source, extra[:]); err != io.EOF {
			return errors.New("upload size does not match content length")
		}
		if validate != nil {
			return validate()
		}
		return nil
	})
}
