package app

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"os"
	"sync"

	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (s *DesktopAIService) taskFile(sessionID, taskID string) (*aiworkspace.FileArtifact, error) {
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

func (s *DesktopAIService) GetTaskFile(sessionID, taskID string) (protocol.ContentReference, error) {
	db, err := s.database()
	if err != nil {
		return protocol.ContentReference{}, err
	}
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return protocol.ContentReference{}, err
	}
	defer tx.Rollback()
	var id string
	if err := tx.QueryRow(`SELECT artifact_content_id FROM desktop_ai_session_tasks t JOIN desktop_ai_sessions s ON s.id=t.session_id WHERE t.session_id=? AND t.item_id=? AND artifact_content_id IS NOT NULL AND s.status<>'closed'`, sessionID, taskID).Scan(&id); err != nil {
		return protocol.ContentReference{}, err
	}
	ref, err := desktopPublicContentReference(context.Background(), tx, id)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	return ref, tx.Commit()
}

func (s *DesktopAIService) SaveTaskFile(sessionID, taskID string) error {
	file, err := s.taskFile(sessionID, taskID)
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
	if trackedDesktopAITool(task.ToolName) {
		record, err := s.loadSession(sessionID)
		if err != nil {
			return desktopAIToolResult{}, err
		}
		origin, ok := record.ExecutionOrigins[task.ID]
		if !ok {
			return desktopAIToolResult{}, errors.New("AI execution origin is missing")
		}
		ctx = context.WithValue(ctx, desktopAIExecutionContextKey{}, desktopAIExecutionParent{ID: desktopAIExecutionID(sessionID, task.ID), Actor: origin.Actor})
	}

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
		previous := output
		output = text
		s.mu.Lock()
		if request := s.activeRequests[sessionID]; request != nil {
			request.CommandOutputs[task.ID] = text
		}
		s.mu.Unlock()
		_ = aiwire.OutputDeltas(sessionID, task.ID, previous, text, func(delta protocol.AITaskOutputDelta) error {
			s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "task.output.delta", Output: &delta})
			return nil
		})
		progress := task
		progress.Artifact = nil
		progress.Arguments = aiworkspace.PublicArguments(progress.ToolName, progress.Arguments)
		progress.CommandOutput = ""
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
