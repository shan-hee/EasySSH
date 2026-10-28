package aichat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"

	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/google/uuid"
)

type writeFileArguments struct {
	ServerID string  `json:"server_id"`
	Path     string  `json:"path"`
	Content  *string `json:"content"`
}

func (s *ToolExecutorService) readFileSnapshot(ctx context.Context, userID uuid.UUID, serverID, filePath string) (string, bool, error) {
	id, err := uuid.Parse(serverID)
	if err != nil {
		return "", false, err
	}
	client, err := s.sftpPool.Get(ctx, userID, id)
	if err != nil {
		return "", false, err
	}
	defer client.Release()
	return readPreviewFile(client.Client, filePath)
}

// Read through the opened handle and enforce the limit during the read as well:
// a symlink target or a growing log can exceed its earlier metadata size.
func readPreviewFile(client *sftp.Client, filePath string) (string, bool, error) {
	file, err := client.OpenFile(filePath)
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", true, err
	}
	if !info.Mode().IsRegular() || info.Size() > aiworkspace.MaxFileBytes {
		return "", true, errors.New("file is not supported for preview (text files up to 2 MiB)")
	}
	data, err := io.ReadAll(io.LimitReader(file, aiworkspace.MaxFileBytes+1))
	if err != nil {
		return "", true, err
	}
	if len(data) > aiworkspace.MaxFileBytes {
		return "", true, errors.New("file exceeds the 2 MiB preview limit")
	}
	return string(data), true, nil
}

func (s *ToolExecutorService) prepareWriteFile(ctx context.Context, userID uuid.UUID, raw json.RawMessage) (*aiworkspace.FileArtifact, error) {
	var args writeFileArguments
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, err
	}
	if args.Content == nil || args.ServerID == "" || args.Path == "" {
		return nil, errors.New("server_id, path and string content are required")
	}
	before, existed, err := s.readFileSnapshot(ctx, userID, args.ServerID, args.Path)
	if err != nil {
		return nil, err
	}
	return aiworkspace.PrepareWrite(args.ServerID, args.Path, before, *args.Content, existed)
}
