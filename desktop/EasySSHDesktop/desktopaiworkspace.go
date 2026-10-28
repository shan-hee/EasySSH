package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"sync"

	"github.com/easyssh/shared/aiworkspace"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (s *DesktopAIService) GetTaskFile(sessionID, taskID string) (*aiworkspace.FileArtifact, error) {
	record, err := s.loadSession(sessionID)
	if err != nil {
		return nil, err
	}
	index := desktopAIFindTaskIndex(record.Tasks, taskID)
	if index < 0 || record.Tasks[index].Artifact == nil {
		return nil, errors.New("file not found in this conversation")
	}
	return record.Tasks[index].Artifact, nil
}

func (s *DesktopAIService) SaveTaskFile(sessionID, taskID string) error {
	file, err := s.GetTaskFile(sessionID, taskID)
	if err != nil {
		return err
	}
	app := application.Get()
	if app == nil {
		return errors.New("desktop application is unavailable")
	}
	destination, err := app.Dialog.SaveFile().SetFilename(file.Name).PromptForSingleSelection()
	if err != nil || destination == "" {
		return err
	}
	data := []byte(file.Content)
	if file.Encoding == "base64" {
		data, err = base64.StdEncoding.DecodeString(file.Content)
		if err != nil {
			return err
		}
	}
	return os.WriteFile(destination, data, 0600)
}

func (s *DesktopAIService) prepareDesktopWrite(ctx context.Context, args map[string]any) (*aiworkspace.FileArtifact, error) {
	if s.sftpService == nil {
		return nil, errors.New("SFTP 服务不可用")
	}
	serverID, filePath := desktopAIStringArg(args, "server_id"), desktopAIStringArg(args, "path")
	content, ok := args["content"].(string)
	if !ok || serverID == "" || filePath == "" {
		return nil, errors.New("server_id, path and string content are required")
	}
	before, err := s.sftpService.ReadFileContext(ctx, DesktopSFTPPathInput{ServerID: serverID, Path: filePath})
	existed := !errors.Is(err, os.ErrNotExist)
	if err != nil && existed {
		return nil, err
	}
	return aiworkspace.PrepareWrite(serverID, filePath, before, content, existed)
}

func (s *DesktopAIService) executeWorkspaceTool(ctx context.Context, sessionID string, task DesktopAITaskView) (desktopAIToolResult, error) {
	var mu sync.Mutex
	closed := false
	output := ""
	executionCtx := aiworkspace.WithFile(ctx, task.Artifact)
	executionCtx = aiworkspace.WithProgress(executionCtx, func(text string) {
		mu.Lock()
		defer mu.Unlock()
		if closed || ctx.Err() != nil {
			return
		}
		output = text
		s.mu.Lock()
		if request := s.activeRequests[sessionID]; request != nil {
			request.CommandOutputs[task.ID] = text
		}
		s.mu.Unlock()
		progress := task
		progress.Artifact = nil
		progress.Arguments = aiworkspace.PublicArguments(progress.ToolName, progress.Arguments)
		progress.CommandOutput = text
		progress.Status = DesktopAITaskRunning
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "task.updated", Task: &progress})
	})
	result, err := s.executeDesktopAITool(executionCtx, task.ToolName, task.Arguments)
	mu.Lock()
	closed = true
	if result.CommandOutput == "" {
		result.CommandOutput = output
	}
	mu.Unlock()
	return result, err
}

func createDesktopArtifact(args map[string]any) (desktopAIToolResult, error) {
	raw, err := json.Marshal(args)
	if err != nil {
		return desktopAIToolResult{}, err
	}
	file, err := aiworkspace.Create(raw)
	if err != nil {
		return desktopAIToolResult{}, err
	}
	return desktopAIToolResult{Content: "文件已生成，可在文件面板预览和下载：" + file.Name, Artifact: file}, nil
}
