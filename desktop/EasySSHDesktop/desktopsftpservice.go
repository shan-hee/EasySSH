package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/sftputil"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const desktopSFTPMaxTextBytes = sftputil.MaxTextFileBytes

type DesktopSFTPPathInput struct {
	ServerID string `json:"serverId"`
	Path     string `json:"path"`
}

type DesktopSFTPRenameInput struct {
	ServerID string `json:"serverId"`
	OldPath  string `json:"oldPath"`
	NewPath  string `json:"newPath"`
}

type DesktopSFTPWriteFileInput struct {
	ServerID string `json:"serverId"`
	Path     string `json:"path"`
	Content  string `json:"content"`
}

type DesktopSFTPChmodInput struct {
	ServerID string `json:"serverId"`
	Path     string `json:"path"`
	Mode     string `json:"mode"`
}

type DesktopSFTPUploadFileInput struct {
	ServerID string `json:"serverId"`
	Path     string `json:"path"`
	FileName string `json:"fileName"`
	Data     string `json:"data"`
	TaskID   string `json:"taskId,omitempty"`
}

type DesktopSFTPDownloadFileInput struct {
	ServerID  string `json:"serverId"`
	Path      string `json:"path"`
	LocalPath string `json:"localPath"`
	TaskID    string `json:"taskId,omitempty"`
}

type DesktopSFTPBatchDeleteInput struct {
	ServerID string   `json:"serverId"`
	Paths    []string `json:"paths"`
}

type DesktopSFTPBatchDownloadInput struct {
	ServerID        string   `json:"serverId"`
	Paths           []string `json:"paths"`
	LocalPath       string   `json:"localPath"`
	Mode            string   `json:"mode,omitempty"`
	ExcludePatterns []string `json:"excludePatterns,omitempty"`
	TaskID          string   `json:"taskId,omitempty"`
}

type DesktopSFTPDirectTransferInput struct {
	SourceServerID   string                `json:"sourceServerId"`
	SourcePath       string                `json:"sourcePath"`
	TargetServerID   string                `json:"targetServerId"`
	TargetPath       string                `json:"targetPath"`
	TaskID           string                `json:"taskId,omitempty"`
	SourceCredential *DesktopSSHCredential `json:"sourceCredential,omitempty"`
	TargetCredential *DesktopSSHCredential `json:"targetCredential,omitempty"`
}

type DesktopSFTPAuthenticateInput struct {
	ServerID             string                  `json:"serverId"`
	AuthMethod           DesktopServerAuthMethod `json:"authMethod"`
	Secret               string                  `json:"secret"`
	Password             string                  `json:"password,omitempty"`
	PrivateKey           string                  `json:"privateKey,omitempty"`
	PrivateKeyPassphrase string                  `json:"privateKeyPassphrase,omitempty"`
}

type DesktopSFTPFileInfo struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	Mode       uint32 `json:"mode"`
	ModTime    string `json:"mod_time"`
	IsDir      bool   `json:"is_dir"`
	IsLink     bool   `json:"is_link"`
	LinkTarget string `json:"link_target,omitempty"`
	Permission string `json:"permission,omitempty"`
}

type DesktopSFTPDirectoryListResult struct {
	Path    string                `json:"path"`
	Files   []DesktopSFTPFileInfo `json:"files"`
	Parent  string                `json:"parent,omitempty"`
	CanRead bool                  `json:"can_read"`
}

type DesktopSFTPBatchOperationError struct {
	Path    string `json:"path"`
	Error   string `json:"error"`
	Message string `json:"message"`
}

type DesktopSFTPBatchDeleteResult struct {
	Success []string                         `json:"success"`
	Failed  []DesktopSFTPBatchOperationError `json:"failed"`
	Total   int                              `json:"total"`
}

type DesktopSFTPDeletePathsResult struct {
	Mode         string   `json:"mode"`
	DeletedPaths []string `json:"deleted_paths"`
	TaskID       string   `json:"task_id,omitempty"`
}

type DesktopSFTPUploadTaskListResult struct {
	Tasks []DesktopSFTPUploadTaskStatus `json:"tasks"`
}

type DesktopSFTPUploadTaskStatus struct {
	ID         string `json:"id"`
	Type       string `json:"type,omitempty"`
	FileName   string `json:"file_name"`
	FileSize   int64  `json:"file_size"`
	ServerID   string `json:"server_id,omitempty"`
	RemotePath string `json:"remote_path,omitempty"`
	Status     string `json:"status"`
	Stage      string `json:"stage,omitempty"`
	Progress   int    `json:"progress"`
	Loaded     int64  `json:"loaded"`
	Total      int64  `json:"total"`
	SpeedBps   int64  `json:"speed_bps"`
	Message    string `json:"message,omitempty"`
	Error      string `json:"error,omitempty"`
	CreatedAt  string `json:"created_at"`
	StartedAt  string `json:"started_at,omitempty"`
	UpdatedAt  string `json:"updated_at"`
	EndedAt    string `json:"ended_at,omitempty"`
}

type DesktopSFTPDirectTransferResult struct {
	Success bool   `json:"success"`
	TaskID  string `json:"task_id"`
	Message string `json:"message"`
}

type DesktopSFTPDiskUsageResult struct {
	Path         string  `json:"path"`
	Total        int64   `json:"total"`
	Used         int64   `json:"used"`
	Available    int64   `json:"available"`
	UsagePercent float64 `json:"usage_percent"`
}

type desktopSFTPTaskKind string

const (
	desktopSFTPTaskUpload   desktopSFTPTaskKind = "upload"
	desktopSFTPTaskDownload desktopSFTPTaskKind = "download"
	desktopSFTPTaskTransfer desktopSFTPTaskKind = "transfer"
	desktopSFTPTaskDelete   desktopSFTPTaskKind = "delete"
)

var errDesktopSFTPTaskCancelled = errors.New("transfer cancelled")

type desktopSFTPTask struct {
	DesktopSFTPUploadTaskStatus
	kind      desktopSFTPTaskKind
	createdAt time.Time
	startedAt time.Time
	endedAt   time.Time
	cancelled bool
}

type desktopSFTPAuthenticatedSSHClient struct {
	client          *ssh.Client
	credential      DesktopSSHCredential
	authenticatedAt time.Time
}

type DesktopSFTPService struct {
	serverService    *DesktopServerService
	activityLog      *ActivityLogService
	notifications    *DesktopNotificationService
	taskMu           sync.Mutex
	tasks            map[string]*desktopSFTPTask
	authenticatedMu  sync.Mutex
	authenticatedSSH map[string]*desktopSFTPAuthenticatedSSHClient
}

func NewDesktopSFTPService(serverService *DesktopServerService, activityLog *ActivityLogService, notifications *DesktopNotificationService) *DesktopSFTPService {
	return &DesktopSFTPService{
		serverService:    serverService,
		activityLog:      activityLog,
		notifications:    notifications,
		tasks:            make(map[string]*desktopSFTPTask),
		authenticatedSSH: make(map[string]*desktopSFTPAuthenticatedSSHClient),
	}
}

func (s *DesktopSFTPService) createTask(kind desktopSFTPTaskKind, taskID string, fileName string, fileSize int64, serverID string, remotePath string) string {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		taskID = fmt.Sprintf("desktop-%s-%d", kind, time.Now().UnixNano())
	}
	now := time.Now().UTC()

	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	if task, ok := s.tasks[taskID]; ok {
		task.kind = kind
		task.Type = string(kind)
		task.FileName = firstNonEmptyDesktopSFTP(fileName, task.FileName)
		if fileSize > 0 {
			task.FileSize = fileSize
			task.Total = fileSize
		}
		task.ServerID = firstNonEmptyDesktopSFTP(serverID, task.ServerID)
		task.RemotePath = firstNonEmptyDesktopSFTP(remotePath, task.RemotePath)
		task.UpdatedAt = now.Format(time.RFC3339Nano)
		return taskID
	}

	status := "pending"
	if kind == desktopSFTPTaskTransfer {
		status = "transferring"
	}
	s.tasks[taskID] = &desktopSFTPTask{
		kind:      kind,
		createdAt: now,
		DesktopSFTPUploadTaskStatus: DesktopSFTPUploadTaskStatus{
			ID:         taskID,
			Type:       string(kind),
			FileName:   fileName,
			FileSize:   fileSize,
			ServerID:   serverID,
			RemotePath: remotePath,
			Status:     status,
			Stage:      "stream",
			Total:      fileSize,
			CreatedAt:  now.Format(time.RFC3339Nano),
			UpdatedAt:  now.Format(time.RFC3339Nano),
		},
	}
	return taskID
}

func (s *DesktopSFTPService) startTask(taskID string, status string, total int64) error {
	now := time.Now().UTC()

	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	task, ok := s.tasks[taskID]
	if !ok {
		return nil
	}
	if task.cancelled || task.Status == "cancelled" {
		return errDesktopSFTPTaskCancelled
	}
	task.Status = status
	if total > 0 {
		task.FileSize = total
		task.Total = total
	}
	task.Progress = 0
	task.Loaded = 0
	task.SpeedBps = 0
	task.Error = ""
	task.Message = ""
	task.startedAt = now
	task.StartedAt = now.Format(time.RFC3339Nano)
	task.UpdatedAt = task.StartedAt
	return nil
}

func (s *DesktopSFTPService) updateTaskProgress(taskID string, loaded int64, total int64, stage string) error {
	now := time.Now().UTC()

	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	task, ok := s.tasks[taskID]
	if !ok {
		return nil
	}
	if task.cancelled || task.Status == "cancelled" {
		return errDesktopSFTPTaskCancelled
	}
	if total > 0 {
		task.FileSize = total
		task.Total = total
	}
	if loaded < 0 {
		loaded = 0
	}
	task.Loaded = loaded
	if stage != "" {
		task.Stage = stage
	}
	task.Progress = desktopSFTPProgressPercent(task.Loaded, task.Total)
	if !task.startedAt.IsZero() {
		elapsed := now.Sub(task.startedAt).Seconds()
		if elapsed > 0 {
			task.SpeedBps = int64(float64(task.Loaded) / elapsed)
		}
	}
	task.UpdatedAt = now.Format(time.RFC3339Nano)
	return nil
}

func (s *DesktopSFTPService) completeTask(taskID string, message string) {
	now := time.Now().UTC()

	s.taskMu.Lock()
	task, ok := s.tasks[taskID]
	if !ok {
		s.taskMu.Unlock()
		return
	}
	if task.Status == "cancelled" {
		s.taskMu.Unlock()
		return
	}
	if task.Total > 0 && task.Loaded < task.Total {
		task.Loaded = task.Total
	}
	task.Progress = 100
	task.Status = "completed"
	task.Message = message
	task.endedAt = now
	task.EndedAt = now.Format(time.RFC3339Nano)
	task.UpdatedAt = task.EndedAt
	snapshot := task.DesktopSFTPUploadTaskStatus
	kind := task.kind
	s.taskMu.Unlock()
	if s.notifications != nil && kind != desktopSFTPTaskDelete {
		_ = s.notifications.Publish("task.succeeded", "success", desktopSFTPTaskTitle(snapshot.Type, true), firstNonEmptyDesktopSFTP(message, snapshot.FileName), "")
	}
}

func (s *DesktopSFTPService) failTask(taskID string, err error) {
	now := time.Now().UTC()
	message := ""
	if err != nil {
		message = err.Error()
	}

	s.taskMu.Lock()
	task, ok := s.tasks[taskID]
	if !ok {
		s.taskMu.Unlock()
		return
	}
	if task.Status == "cancelled" {
		s.taskMu.Unlock()
		return
	}
	task.Status = "failed"
	task.Error = message
	task.endedAt = now
	task.EndedAt = now.Format(time.RFC3339Nano)
	task.UpdatedAt = task.EndedAt
	snapshot := task.DesktopSFTPUploadTaskStatus
	kind := task.kind
	s.taskMu.Unlock()
	if s.notifications != nil && kind != desktopSFTPTaskDelete {
		_ = s.notifications.Publish("task.failed", "error", desktopSFTPTaskTitle(snapshot.Type, false), firstNonEmptyDesktopSFTP(message, snapshot.FileName), "")
	}
}

func desktopSFTPTaskTitle(taskType string, success bool) string {
	action := "传输"
	if strings.Contains(taskType, "upload") {
		action = "上传"
	}
	if strings.Contains(taskType, "download") {
		action = "下载"
	}
	if strings.Contains(taskType, "transfer") {
		action = "跨服务器传输"
	}
	if strings.Contains(taskType, "delete") {
		action = "删除"
	}
	if success {
		return action + "完成"
	}
	return action + "失败"
}

func (s *DesktopSFTPService) cancelTask(taskID string, kind desktopSFTPTaskKind) error {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil
	}
	now := time.Now().UTC()

	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	task, ok := s.tasks[taskID]
	if !ok {
		task = &desktopSFTPTask{
			kind:      kind,
			createdAt: now,
			DesktopSFTPUploadTaskStatus: DesktopSFTPUploadTaskStatus{
				ID:        taskID,
				Type:      string(kind),
				Status:    "cancelled",
				Progress:  0,
				Message:   "已取消",
				CreatedAt: now.Format(time.RFC3339Nano),
				UpdatedAt: now.Format(time.RFC3339Nano),
				EndedAt:   now.Format(time.RFC3339Nano),
			},
		}
		s.tasks[taskID] = task
	}
	task.cancelled = true
	task.Status = "cancelled"
	task.Message = "已取消"
	task.endedAt = now
	task.EndedAt = now.Format(time.RFC3339Nano)
	task.UpdatedAt = task.EndedAt
	return nil
}

func (s *DesktopSFTPService) cancelAnyTask(taskID string) error {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil
	}

	s.taskMu.Lock()
	task, ok := s.tasks[taskID]
	kind := desktopSFTPTaskTransfer
	if ok {
		kind = task.kind
	}
	s.taskMu.Unlock()

	return s.cancelTask(taskID, kind)
}

func (s *DesktopSFTPService) isTaskCancelled(taskID string) bool {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	task, ok := s.tasks[taskID]
	return ok && (task.cancelled || task.Status == "cancelled")
}

func (s *DesktopSFTPService) listTasks(kind desktopSFTPTaskKind) []DesktopSFTPUploadTaskStatus {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	s.pruneSettledTasksLocked(time.Now().UTC())
	tasks := make([]DesktopSFTPUploadTaskStatus, 0, len(s.tasks))
	for _, task := range s.tasks {
		if task.kind != kind {
			continue
		}
		tasks = append(tasks, task.DesktopSFTPUploadTaskStatus)
	}
	return tasks
}

func (s *DesktopSFTPService) getTaskStatus(taskID string, kind desktopSFTPTaskKind) (DesktopSFTPUploadTaskStatus, error) {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	task, ok := s.tasks[strings.TrimSpace(taskID)]
	if !ok || task.kind != kind {
		return DesktopSFTPUploadTaskStatus{}, errors.New("task not found")
	}
	return task.DesktopSFTPUploadTaskStatus, nil
}

func (s *DesktopSFTPService) getAnyTaskStatus(taskID string) (DesktopSFTPUploadTaskStatus, error) {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	task, ok := s.tasks[strings.TrimSpace(taskID)]
	if !ok {
		return DesktopSFTPUploadTaskStatus{}, errors.New("task not found")
	}
	return task.DesktopSFTPUploadTaskStatus, nil
}

func (s *DesktopSFTPService) pruneSettledTasksLocked(now time.Time) {
	const settledTaskTTL = time.Hour
	for taskID, task := range s.tasks {
		if task.EndedAt == "" || task.endedAt.IsZero() {
			continue
		}
		if now.Sub(task.endedAt) > settledTaskTTL {
			delete(s.tasks, taskID)
		}
	}
}

func (s *DesktopSFTPService) recordSFTPActivity(action string, serverID string, resource string, status DesktopActivityLogStatus, started time.Time, detail map[string]any) {
	if s.activityLog == nil {
		return
	}

	detailText := ""
	if len(detail) > 0 {
		encoded, err := json.Marshal(detail)
		if err != nil {
			detailText = fmt.Sprintf("%v", detail)
		} else {
			detailText = string(encoded)
		}
	}

	_, err := s.activityLog.Record(DesktopActivityLogRecordInput{
		Action:     action,
		Resource:   resource,
		Status:     status,
		ServerID:   serverID,
		DurationMs: time.Since(started).Milliseconds(),
		Detail:     detailText,
	})
	if err != nil {
		desktopLogPrintf("failed to record desktop sftp activity: %v", err)
	}
}

func desktopSFTPActivityStatus(err error) DesktopActivityLogStatus {
	if err == nil {
		return DesktopActivityLogSuccess
	}
	if errors.Is(err, errDesktopSFTPTaskCancelled) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return DesktopActivityLogWarning
	}
	return DesktopActivityLogFailure
}

func (s *DesktopSFTPService) Authenticate(input DesktopSFTPAuthenticateInput) error {
	serverID := strings.TrimSpace(input.ServerID)
	if serverID == "" {
		return errors.New("server id is required")
	}
	input.AuthMethod = normalizeDesktopServerAuthMethod(input.AuthMethod)
	if !input.AuthMethod.IsValid() {
		return fmt.Errorf("unsupported auth method: %s", input.AuthMethod)
	}

	credential := DesktopSSHCredential{
		AuthMethod:           input.AuthMethod,
		Secret:               input.Secret,
		Password:             input.Password,
		PrivateKey:           input.PrivateKey,
		PrivateKeyPassphrase: input.PrivateKeyPassphrase,
	}
	_, closer, err := s.openClientWithCredential(serverID, &credential)
	if err != nil {
		return err
	}
	closer()

	s.clearAuthenticatedSSHClient(serverID)
	s.serverService.setTemporaryCredential(serverID, credential)
	return nil
}

func (s *DesktopSFTPService) ListDirectory(input DesktopSFTPPathInput) (DesktopSFTPDirectoryListResult, error) {
	return s.ListDirectoryContext(context.Background(), input)
}

func (s *DesktopSFTPService) ListDirectoryContext(ctx context.Context, input DesktopSFTPPathInput) (DesktopSFTPDirectoryListResult, error) {
	ctx = desktopNonNilContext(ctx)
	remotePath := sftputil.NormalizePath(input.Path)
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return DesktopSFTPDirectoryListResult{}, err
	}
	closer = desktopSFTPContextCloser(ctx, closer)
	defer closer()

	if err := ctx.Err(); err != nil {
		return DesktopSFTPDirectoryListResult{}, err
	}
	entries, err := client.ReadDir(remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPDirectoryListResult{}, ctxErr
		}
		return DesktopSFTPDirectoryListResult{}, err
	}

	files := make([]DesktopSFTPFileInfo, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}

		fullPath := sftputil.JoinPath(remotePath, name)
		linkTarget := ""
		if entry.Mode()&os.ModeSymlink != 0 {
			if target, readErr := client.ReadLink(fullPath); readErr == nil {
				linkTarget = target
			}
		}
		files = append(files, desktopSFTPFileInfoFromFileInfo(fullPath, entry, linkTarget))
	}

	return DesktopSFTPDirectoryListResult{
		Path:    remotePath,
		Parent:  sftputil.ParentPath(remotePath),
		Files:   files,
		CanRead: true,
	}, nil
}

func (s *DesktopSFTPService) GetFileInfo(input DesktopSFTPPathInput) (DesktopSFTPFileInfo, error) {
	remotePath := sftputil.NormalizePath(input.Path)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	return desktopSFTPStat(client, remotePath)
}

func (s *DesktopSFTPService) GetDiskUsage(input DesktopSFTPPathInput) (DesktopSFTPDiskUsageResult, error) {
	remotePath := sftputil.NormalizePath(input.Path)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPDiskUsageResult{}, err
	}
	defer closer()

	stat, err := client.StatVFS(remotePath)
	if err != nil {
		return DesktopSFTPDiskUsageResult{}, err
	}

	total := desktopSFTPBlocksToBytes(stat.Bsize, stat.Blocks)
	available := desktopSFTPBlocksToBytes(stat.Bsize, stat.Bavail)
	if available < 0 {
		available = 0
	}
	used := total - available
	if used < 0 {
		used = 0
	}
	usagePercent := 0.0
	if total > 0 {
		usagePercent = float64(used) / float64(total) * 100
	}

	return DesktopSFTPDiskUsageResult{
		Path:         remotePath,
		Total:        total,
		Used:         used,
		Available:    available,
		UsagePercent: usagePercent,
	}, nil
}

func (s *DesktopSFTPService) Delete(input DesktopSFTPPathInput) (snapshot DesktopSFTPFileInfo, err error) {
	return s.DeleteContext(context.Background(), input)
}

func (s *DesktopSFTPService) DeleteContext(ctx context.Context, input DesktopSFTPPathInput) (snapshot DesktopSFTPFileInfo, err error) {
	ctx = desktopNonNilContext(ctx)
	remotePath := sftputil.NormalizePath(input.Path)
	started := time.Now().UTC()
	defer func() {
		detail := map[string]any{
			"source_path": remotePath,
			"file_name":   path.Base(remotePath),
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		s.recordSFTPActivity("sftp_delete", input.ServerID, remotePath, desktopSFTPActivityStatus(err), started, detail)
		if s.notifications != nil {
			if err != nil {
				_ = s.notifications.Publish("task.failed", "error", "删除失败", remotePath+"："+err.Error(), "")
			} else {
				_ = s.notifications.Publish("task.succeeded", "success", "删除完成", remotePath, "")
			}
		}
	}()

	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	closer = desktopSFTPContextCloser(ctx, closer)
	defer closer()

	if err := ctx.Err(); err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	info, err := client.Lstat(remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
		return DesktopSFTPFileInfo{}, err
	}
	snapshot = desktopSFTPFileInfoFromFileInfo(remotePath, info, "")

	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		return DesktopSFTPFileInfo{}, errors.New("directory deletion must use DeletePaths")
	}
	err = client.Remove(remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
		return DesktopSFTPFileInfo{}, err
	}

	return snapshot, nil
}

func (s *DesktopSFTPService) BatchDelete(input DesktopSFTPBatchDeleteInput) (result DesktopSFTPBatchDeleteResult, err error) {
	return s.batchDelete(input, false)
}

func (s *DesktopSFTPService) batchDelete(input DesktopSFTPBatchDeleteInput, allowRecursive bool) (result DesktopSFTPBatchDeleteResult, err error) {
	started := time.Now().UTC()
	normalizedPaths := make([]string, 0, len(input.Paths))
	for _, itemPath := range input.Paths {
		normalizedPaths = append(normalizedPaths, sftputil.NormalizePath(itemPath))
	}
	defer func() {
		detail := map[string]any{
			"source_path": strings.Join(normalizedPaths, ","),
			"file_count":  len(normalizedPaths),
			"success":     len(result.Success),
			"failed":      len(result.Failed),
		}
		if err != nil {
			detail["error"] = err.Error()
		} else if len(result.Failed) > 0 {
			detail["failed_paths"] = result.Failed
		}
		status := desktopSFTPActivityStatus(err)
		if err == nil && len(result.Failed) > 0 {
			status = DesktopActivityLogWarning
		}
		s.recordSFTPActivity("sftp_delete", input.ServerID, strings.Join(normalizedPaths, ","), status, started, detail)
		if s.notifications != nil {
			message := fmt.Sprintf("成功 %d，失败 %d", len(result.Success), len(result.Failed))
			if err != nil || len(result.Failed) == len(normalizedPaths) {
				_ = s.notifications.Publish("task.failed", "error", "批量删除失败", message, "")
			} else if len(result.Failed) > 0 {
				_ = s.notifications.Publish("task.partial_success", "warning", "批量删除部分成功", message, "")
			} else {
				_ = s.notifications.Publish("task.succeeded", "success", "批量删除完成", message, "")
			}
		}
	}()

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPBatchDeleteResult{}, err
	}
	defer closer()

	result = DesktopSFTPBatchDeleteResult{
		Success: []string{},
		Failed:  []DesktopSFTPBatchOperationError{},
		Total:   len(input.Paths),
	}

	for _, remotePath := range normalizedPaths {
		info, statErr := client.Lstat(remotePath)
		if statErr != nil {
			result.Failed = append(result.Failed, desktopSFTPBatchError(remotePath, statErr))
			continue
		}

		if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			if !allowRecursive {
				result.Failed = append(result.Failed, desktopSFTPBatchError(remotePath, errors.New("directory deletion must use DeletePaths")))
				continue
			}
			err = removeDesktopSFTPDirectory(client, remotePath)
		} else {
			err = client.Remove(remotePath)
		}
		if err != nil {
			result.Failed = append(result.Failed, desktopSFTPBatchError(remotePath, err))
			continue
		}

		result.Success = append(result.Success, remotePath)
	}

	return result, nil
}

func (s *DesktopSFTPService) DeletePaths(input DesktopSFTPBatchDeleteInput) (DesktopSFTPDeletePathsResult, error) {
	normalizedPaths, err := normalizeDesktopSFTPDeletePaths(input.Paths)
	if err != nil {
		return DesktopSFTPDeletePathsResult{}, err
	}
	started := time.Now().UTC()
	connected, fastDeleteErr := s.fastDeletePaths(input.ServerID, normalizedPaths)
	if fastDeleteErr == nil {
		s.recordSFTPActivity("sftp_delete", input.ServerID, strings.Join(normalizedPaths, ","), DesktopActivityLogSuccess, started, map[string]any{
			"strategy": "ssh_rm_rf", "file_count": len(normalizedPaths),
		})
		return DesktopSFTPDeletePathsResult{Mode: "fast", DeletedPaths: normalizedPaths}, nil
	}
	if !connected {
		return DesktopSFTPDeletePathsResult{}, fastDeleteErr
	}

	input.Paths = normalizedPaths
	taskID := s.createTask(desktopSFTPTaskDelete, "", fmt.Sprintf("%d items", len(normalizedPaths)), int64(len(normalizedPaths)), input.ServerID, strings.Join(normalizedPaths, ","))
	go func() {
		_ = s.startTask(taskID, "running", int64(len(normalizedPaths)))
		result, err := s.batchDelete(input, true)
		_ = s.updateTaskProgress(taskID, int64(len(result.Success)+len(result.Failed)), int64(len(normalizedPaths)), "sftp_recursive")
		if err != nil || len(result.Failed) == len(normalizedPaths) {
			if err == nil {
				err = errors.New("all paths failed to delete")
			}
			s.failTask(taskID, err)
			return
		}
		s.completeTask(taskID, fmt.Sprintf("成功 %d，失败 %d", len(result.Success), len(result.Failed)))
	}()
	return DesktopSFTPDeletePathsResult{Mode: "recursive_task", DeletedPaths: []string{}, TaskID: taskID}, nil
}

func (s *DesktopSFTPService) fastDeletePaths(serverID string, remotePaths []string) (bool, error) {
	sshClient, closer, err := s.openSSHClient(serverID)
	if err != nil {
		return false, err
	}
	defer closer()
	session, err := sshClient.NewSession()
	if err != nil {
		return true, err
	}
	defer session.Close()
	quoted := make([]string, 0, len(remotePaths))
	for _, remotePath := range remotePaths {
		quoted = append(quoted, desktopSFTPShellQuote(remotePath))
	}
	var stderr bytes.Buffer
	session.Stderr = &stderr
	if err := session.Run("rm -rf -- " + strings.Join(quoted, " ")); err != nil {
		if message := strings.TrimSpace(stderr.String()); message != "" {
			return true, fmt.Errorf("fast delete failed: %w: %s", err, message)
		}
		return true, fmt.Errorf("fast delete failed: %w", err)
	}
	return true, nil
}

func normalizeDesktopSFTPDeletePaths(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, errors.New("paths are required")
	}
	if len(paths) > 100 {
		return nil, errors.New("at most 100 paths can be deleted at once")
	}
	protected := map[string]struct{}{"/": {}, "/bin": {}, "/boot": {}, "/dev": {}, "/etc": {}, "/home": {}, "/lib": {}, "/lib64": {}, "/proc": {}, "/root": {}, "/run": {}, "/sbin": {}, "/sys": {}, "/usr": {}, "/var": {}}
	normalized := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, remotePath := range paths {
		remotePath = strings.TrimSpace(remotePath)
		if strings.ContainsRune(remotePath, '\x00') {
			return nil, errors.New("path must not contain null bytes")
		}
		if !strings.HasPrefix(remotePath, "/") {
			return nil, errors.New("deletion requires absolute paths")
		}
		remotePath = sftputil.NormalizePath(remotePath)
		if _, exists := protected[remotePath]; exists {
			return nil, fmt.Errorf("refusing to delete protected path %s", remotePath)
		}
		if _, exists := seen[remotePath]; exists {
			continue
		}
		seen[remotePath] = struct{}{}
		normalized = append(normalized, remotePath)
	}
	return normalized, nil
}

func (s *DesktopSFTPService) CreateDirectory(input DesktopSFTPPathInput) (info DesktopSFTPFileInfo, err error) {
	return s.CreateDirectoryContext(context.Background(), input)
}

func (s *DesktopSFTPService) CreateDirectoryContext(ctx context.Context, input DesktopSFTPPathInput) (info DesktopSFTPFileInfo, err error) {
	ctx = desktopNonNilContext(ctx)
	remotePath := sftputil.NormalizePath(input.Path)
	started := time.Now().UTC()
	defer func() {
		detail := map[string]any{
			"dest_path": remotePath,
			"file_name": path.Base(remotePath),
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		s.recordSFTPActivity("sftp_mkdir", input.ServerID, remotePath, desktopSFTPActivityStatus(err), started, detail)
	}()

	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	closer = desktopSFTPContextCloser(ctx, closer)
	defer closer()

	if err := ctx.Err(); err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	err = client.MkdirAll(remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
		return DesktopSFTPFileInfo{}, err
	}

	info, err = desktopSFTPStat(client, remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
	}
	return info, err
}

func (s *DesktopSFTPService) Rename(input DesktopSFTPRenameInput) (info DesktopSFTPFileInfo, err error) {
	oldPath := sftputil.NormalizePath(input.OldPath)
	newPath := sftputil.NormalizePath(input.NewPath)
	started := time.Now().UTC()
	defer func() {
		detail := map[string]any{
			"source_path": oldPath,
			"dest_path":   newPath,
			"file_name":   path.Base(newPath),
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		s.recordSFTPActivity("sftp_rename", input.ServerID, oldPath, desktopSFTPActivityStatus(err), started, detail)
	}()

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	err = client.Rename(oldPath, newPath)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	info, err = desktopSFTPStat(client, newPath)
	return info, err
}

func (s *DesktopSFTPService) ReadFile(input DesktopSFTPPathInput) (string, error) {
	return s.ReadFileContext(context.Background(), input)
}

func (s *DesktopSFTPService) ReadFileContext(ctx context.Context, input DesktopSFTPPathInput) (string, error) {
	ctx = desktopNonNilContext(ctx)
	remotePath := sftputil.NormalizePath(input.Path)
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return "", err
	}
	closer = desktopSFTPContextCloser(ctx, closer)
	defer closer()

	if err := ctx.Err(); err != nil {
		return "", err
	}
	info, err := client.Stat(remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", err
	}
	if info.IsDir() {
		return "", errors.New("cannot read a directory")
	}
	if info.Size() > desktopSFTPMaxTextBytes {
		return "", fmt.Errorf("file is too large to edit: %d bytes", info.Size())
	}

	file, err := client.Open(remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", err
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, desktopSFTPMaxTextBytes+1))
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", err
	}
	if len(content) > desktopSFTPMaxTextBytes {
		return "", fmt.Errorf("file is too large to edit: %d bytes", len(content))
	}

	return string(content), nil
}

func (s *DesktopSFTPService) WriteFile(input DesktopSFTPWriteFileInput) (info DesktopSFTPFileInfo, err error) {
	return s.WriteFileContext(context.Background(), input)
}

func (s *DesktopSFTPService) WriteFileContext(ctx context.Context, input DesktopSFTPWriteFileInput) (info DesktopSFTPFileInfo, err error) {
	ctx = desktopNonNilContext(ctx)
	remotePath := sftputil.NormalizePath(input.Path)
	started := time.Now().UTC()
	defer func() {
		detail := map[string]any{
			"dest_path":   remotePath,
			"file_name":   path.Base(remotePath),
			"bytes_total": len([]byte(input.Content)),
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		s.recordSFTPActivity("sftp_upload", input.ServerID, remotePath, desktopSFTPActivityStatus(err), started, detail)
	}()

	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	closer = desktopSFTPContextCloser(ctx, closer)
	defer closer()

	if err := ctx.Err(); err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	file, err := client.OpenFile(remotePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
		return DesktopSFTPFileInfo{}, err
	}
	_, err = file.Write([]byte(input.Content))
	if err != nil {
		_ = file.Close()
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
		return DesktopSFTPFileInfo{}, err
	}
	err = file.Close()
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
		return DesktopSFTPFileInfo{}, err
	}
	if err := client.Chmod(remotePath, 0o644); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
		return DesktopSFTPFileInfo{}, err
	}

	info, err = desktopSFTPStat(client, remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPFileInfo{}, ctxErr
		}
	}
	return info, err
}

func (s *DesktopSFTPService) Chmod(input DesktopSFTPChmodInput) (err error) {
	remotePath := sftputil.NormalizePath(input.Path)
	started := time.Now().UTC()
	defer func() {
		detail := map[string]any{
			"source_path": remotePath,
			"file_name":   path.Base(remotePath),
			"mode":        input.Mode,
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		s.recordSFTPActivity("sftp_chmod", input.ServerID, remotePath, desktopSFTPActivityStatus(err), started, detail)
	}()

	mode, err := strconv.ParseUint(strings.TrimSpace(input.Mode), 8, 32)
	if err != nil {
		return fmt.Errorf("invalid chmod mode: %w", err)
	}

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return err
	}
	defer closer()

	return client.Chmod(remotePath, os.FileMode(mode))
}

func (s *DesktopSFTPService) UploadFile(input DesktopSFTPUploadFileInput) (info DesktopSFTPFileInfo, err error) {
	basePath := sftputil.NormalizePath(input.Path)
	fileName := path.Base(strings.TrimSpace(input.FileName))
	if fileName == "." || fileName == "/" || fileName == "" {
		return DesktopSFTPFileInfo{}, errors.New("file name is required")
	}

	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	remotePath := sftputil.JoinPath(basePath, fileName)
	started := time.Now().UTC()
	defer func() {
		detail := map[string]any{
			"source_path": "",
			"dest_path":   remotePath,
			"file_name":   fileName,
			"bytes_total": int64(len(data)),
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		s.recordSFTPActivity("sftp_upload", input.ServerID, remotePath, desktopSFTPActivityStatus(err), started, detail)
	}()

	taskID := s.createTask(desktopSFTPTaskUpload, input.TaskID, fileName, int64(len(data)), input.ServerID, remotePath)
	err = s.startTask(taskID, "uploading", int64(len(data)))
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	file, err := client.OpenFile(remotePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPFileInfo{}, err
	}
	_, err = io.Copy(file, newDesktopSFTPProgressReader(bytes.NewReader(data), int64(len(data)), func(loaded int64, total int64) error {
		return s.updateTaskProgress(taskID, loaded, total, "stream")
	}))
	if err != nil {
		_ = file.Close()
		s.failTask(taskID, err)
		return DesktopSFTPFileInfo{}, err
	}
	err = file.Close()
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPFileInfo{}, err
	}
	if err := client.Chmod(remotePath, 0o644); err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPFileInfo{}, err
	}

	info, err = desktopSFTPStat(client, remotePath)
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPFileInfo{}, err
	}
	s.completeTask(taskID, "Upload completed")
	return info, nil
}

func (s *DesktopSFTPService) DownloadFile(input DesktopSFTPDownloadFileInput) (err error) {
	remotePath := sftputil.NormalizePath(input.Path)
	localPath := strings.TrimSpace(input.LocalPath)
	if localPath == "" {
		return errors.New("local path is required")
	}
	started := time.Now().UTC()
	var fileSize int64
	taskID := ""
	defer func() {
		detail := map[string]any{
			"source_path": remotePath,
			"dest_path":   localPath,
			"file_name":   path.Base(remotePath),
			"bytes_total": fileSize,
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		if taskID != "" {
			if err != nil {
				s.failTask(taskID, err)
			} else {
				s.completeTask(taskID, "Download completed")
			}
		}
		s.recordSFTPActivity("sftp_download", input.ServerID, remotePath, desktopSFTPActivityStatus(err), started, detail)
	}()

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return err
	}
	defer closer()

	info, err := client.Stat(remotePath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return errors.New("cannot download a directory as a single file")
	}
	fileSize = info.Size()
	taskID = s.createTask(desktopSFTPTaskDownload, input.TaskID, path.Base(remotePath), fileSize, input.ServerID, remotePath)
	err = s.startTask(taskID, "downloading", fileSize)
	if err != nil {
		return err
	}

	remoteFile, err := client.Open(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	reader := newDesktopSFTPProgressReader(remoteFile, fileSize, func(loaded int64, total int64) error {
		return s.updateTaskProgress(taskID, loaded, total, "stream")
	})
	_, err = io.Copy(localFile, reader)
	if err != nil {
		_ = localFile.Close()
		return err
	}

	err = localFile.Close()
	return err
}

func (s *DesktopSFTPService) BatchDownload(input DesktopSFTPBatchDownloadInput) (err error) {
	localPath := strings.TrimSpace(input.LocalPath)
	if localPath == "" {
		return errors.New("local path is required")
	}
	if len(input.Paths) == 0 {
		return errors.New("paths are required")
	}
	started := time.Now().UTC()
	normalizedPaths := make([]string, 0, len(input.Paths))
	for _, itemPath := range input.Paths {
		normalizedPaths = append(normalizedPaths, sftputil.NormalizePath(itemPath))
	}
	requestedMode := normalizeDesktopSFTPBatchDownloadMode(input.Mode)
	excludePatterns := normalizeDesktopSFTPExcludePatterns(input.ExcludePatterns)
	archiveFormat := "zip"
	if requestedMode == "fast" {
		archiveFormat = "tar.gz"
	}
	excludedCount := 0
	totalBytes := int64(0)
	processedBytes := int64(0)
	taskID := s.createTask(desktopSFTPTaskDownload, input.TaskID, filepath.Base(localPath), 0, input.ServerID, strings.Join(normalizedPaths, ","))
	err = s.startTask(taskID, "downloading", 0)
	if err != nil {
		return err
	}
	defer func() {
		detail := map[string]any{
			"source_path":      strings.Join(normalizedPaths, ","),
			"dest_path":        localPath,
			"file_name":        filepath.Base(localPath),
			"file_count":       len(normalizedPaths),
			"mode":             requestedMode,
			"archive_format":   archiveFormat,
			"exclude_patterns": excludePatterns,
			"excluded_count":   excludedCount,
			"bytes_total":      totalBytes,
			"bytes_processed":  processedBytes,
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		if err != nil {
			s.failTask(taskID, err)
		} else {
			s.completeTask(taskID, "Download completed")
		}
		s.recordSFTPActivity("sftp_download", input.ServerID, strings.Join(normalizedPaths, ","), desktopSFTPActivityStatus(err), started, detail)
	}()

	if requestedMode == "fast" {
		return s.fastBatchDownload(input.ServerID, normalizedPaths, localPath, excludePatterns, taskID, totalBytes, &processedBytes)
	}

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return err
	}
	defer closer()

	totalBytes, err = desktopSFTPPathsSize(client, normalizedPaths, excludePatterns)
	if err != nil {
		return err
	}
	err = s.updateTaskProgress(taskID, 0, totalBytes, "stream")
	if err != nil {
		return err
	}

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	zipWriter := zip.NewWriter(localFile)
	for _, remotePath := range normalizedPaths {
		baseName := strings.Trim(path.Base(remotePath), "/")
		if baseName == "" || baseName == "." {
			baseName = "download"
		}

		var excluded int
		excluded, err = addDesktopSFTPZipEntry(client, zipWriter, remotePath, baseName, excludePatterns, func(copied int64) error {
			processedBytes += copied
			return s.updateTaskProgress(taskID, processedBytes, totalBytes, "stream")
		})
		excludedCount += excluded
		if err != nil {
			_ = zipWriter.Close()
			return err
		}
	}

	return zipWriter.Close()
}

func (s *DesktopSFTPService) fastBatchDownload(serverID string, remotePaths []string, localPath string, excludePatterns []string, taskID string, totalBytes int64, processedBytes *int64) error {
	sshClient, closer, err := s.openSSHClient(serverID)
	if err != nil {
		return err
	}
	defer closer()

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	closeLocalFile := true
	defer func() {
		if closeLocalFile {
			_ = localFile.Close()
		}
	}()

	session, err := sshClient.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	var stderr bytes.Buffer
	session.Stdout = newDesktopSFTPProgressWriter(localFile, totalBytes, func(loaded int64, total int64) error {
		if processedBytes != nil {
			*processedBytes = loaded
		}
		return s.updateTaskProgress(taskID, loaded, total, "stream")
	})
	session.Stderr = &stderr
	if err := session.Run(buildDesktopSFTPTarCommand(remotePaths, excludePatterns)); err != nil {
		if s.isTaskCancelled(taskID) || errors.Is(err, errDesktopSFTPTaskCancelled) {
			return errDesktopSFTPTaskCancelled
		}
		stderrText := strings.TrimSpace(stderr.String())
		if strings.Contains(stderrText, "command not found") || strings.Contains(stderrText, "not found") {
			if stderrText == "" {
				return errors.New("tar not found")
			}
			return fmt.Errorf("tar not found: %s", stderrText)
		}
		if stderrText != "" {
			return fmt.Errorf("tar command failed: %w: %s", err, stderrText)
		}
		return fmt.Errorf("tar command failed: %w", err)
	}
	if s.isTaskCancelled(taskID) {
		return errDesktopSFTPTaskCancelled
	}

	closeLocalFile = false
	return localFile.Close()
}

func (s *DesktopSFTPService) CreateUploadTask() (map[string]string, error) {
	taskID := s.createTask(desktopSFTPTaskUpload, "", "", 0, "", "")
	return map[string]string{"task_id": taskID}, nil
}

func (s *DesktopSFTPService) ListUploadTasks() (DesktopSFTPUploadTaskListResult, error) {
	return DesktopSFTPUploadTaskListResult{Tasks: s.listTasks(desktopSFTPTaskUpload)}, nil
}

func (s *DesktopSFTPService) GetUploadTask(taskID string) (DesktopSFTPUploadTaskStatus, error) {
	return s.getTaskStatus(taskID, desktopSFTPTaskUpload)
}

func (s *DesktopSFTPService) GetTransferTask(taskID string) (DesktopSFTPUploadTaskStatus, error) {
	return s.getAnyTaskStatus(taskID)
}

func (s *DesktopSFTPService) CancelUploadTask(taskID string) error {
	return s.cancelTask(taskID, desktopSFTPTaskUpload)
}

func (s *DesktopSFTPService) DirectTransfer(input DesktopSFTPDirectTransferInput) (result DesktopSFTPDirectTransferResult, err error) {
	sourceServerID := strings.TrimSpace(input.SourceServerID)
	targetServerID := strings.TrimSpace(input.TargetServerID)
	if sourceServerID == "" {
		return DesktopSFTPDirectTransferResult{}, errors.New("source server id is required")
	}
	if targetServerID == "" {
		return DesktopSFTPDirectTransferResult{}, errors.New("target server id is required")
	}

	sourcePath := sftputil.NormalizePath(input.SourcePath)
	targetPath := sftputil.NormalizePath(input.TargetPath)
	if sourceServerID == targetServerID {
		return DesktopSFTPDirectTransferResult{}, errors.New("cannot transfer between the same server")
	}
	started := time.Now().UTC()
	var totalBytes int64
	var stats desktopSFTPTransferStats
	defer func() {
		detail := map[string]any{
			"source_path":      sourcePath,
			"dest_path":        targetPath,
			"file_name":        path.Base(sourcePath),
			"bytes_total":      totalBytes,
			"bytes_processed":  stats.BytesCopied,
			"files_copied":     stats.FilesCopied,
			"source_server_id": sourceServerID,
			"target_server_id": targetServerID,
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		s.recordSFTPActivity("sftp_transfer", sourceServerID, sourcePath, desktopSFTPActivityStatus(err), started, detail)
	}()

	taskID := s.createTask(desktopSFTPTaskTransfer, input.TaskID, path.Base(sourcePath), 0, sourceServerID, sourcePath)
	err = s.startTask(taskID, "transferring", 0)
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, err
	}

	sourceClient, sourceCloser, err := s.openClientForTransfer(sourceServerID, input.SourceCredential)
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPDirectTransferResult{}, fmt.Errorf("failed to connect source server: %w", err)
	}
	defer sourceCloser()

	targetClient, targetCloser, err := s.openClientForTransfer(targetServerID, input.TargetCredential)
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPDirectTransferResult{}, fmt.Errorf("failed to connect target server: %w", err)
	}
	defer targetCloser()

	sourceInfo, err := sourceClient.Stat(sourcePath)
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPDirectTransferResult{}, fmt.Errorf("failed to stat source path: %w", err)
	}
	totalBytes, err = desktopSFTPPathSize(sourceClient, sourcePath, sourceInfo)
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPDirectTransferResult{}, err
	}
	err = s.updateTaskProgress(taskID, 0, totalBytes, "stream")
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, err
	}

	stats, err = copyDesktopSFTPPath(sourceClient, targetClient, sourcePath, targetPath, sourceInfo, func() bool {
		return s.isTaskCancelled(taskID)
	}, func(copied int64) error {
		return s.updateTaskProgress(taskID, copied, totalBytes, "stream")
	})
	if err != nil {
		s.failTask(taskID, err)
		return DesktopSFTPDirectTransferResult{}, err
	}

	message := fmt.Sprintf("Transfer completed: %d file(s), %d byte(s) copied", stats.FilesCopied, stats.BytesCopied)
	s.completeTask(taskID, message)
	return DesktopSFTPDirectTransferResult{
		Success: true,
		TaskID:  taskID,
		Message: message,
	}, nil
}

func (s *DesktopSFTPService) CancelTransfer(taskID string) error {
	return s.cancelAnyTask(taskID)
}

func (s *DesktopSFTPService) CloseConnection(serverID string) error {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil
	}

	s.serverService.clearTemporaryCredential(serverID)
	s.clearAuthenticatedSSHClient(serverID)
	return nil
}

func (s *DesktopSFTPService) setAuthenticatedSSHClient(serverID string, client *ssh.Client, credential DesktopSSHCredential) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" || client == nil {
		return
	}

	s.authenticatedMu.Lock()
	if existing := s.authenticatedSSH[serverID]; existing != nil && existing.client != nil {
		_ = existing.client.Close()
	}
	s.authenticatedSSH[serverID] = &desktopSFTPAuthenticatedSSHClient{
		client:          client,
		credential:      credential,
		authenticatedAt: time.Now(),
	}
	s.authenticatedMu.Unlock()
}

func (s *DesktopSFTPService) getAuthenticatedSSHClient(serverID string) (*ssh.Client, bool) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil, false
	}

	s.authenticatedMu.Lock()
	defer s.authenticatedMu.Unlock()

	entry := s.authenticatedSSH[serverID]
	if entry == nil || entry.client == nil {
		return nil, false
	}

	return entry.client, true
}

func (s *DesktopSFTPService) clearAuthenticatedSSHClient(serverID string) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return
	}

	s.authenticatedMu.Lock()
	entry := s.authenticatedSSH[serverID]
	delete(s.authenticatedSSH, serverID)
	s.authenticatedMu.Unlock()

	if entry != nil && entry.client != nil {
		_ = entry.client.Close()
	}
}

func (s *DesktopSFTPService) openSSHClient(serverID string) (*ssh.Client, func(), error) {
	return s.openSSHClientContext(context.Background(), serverID)
}

func (s *DesktopSFTPService) openSSHClientContext(ctx context.Context, serverID string) (*ssh.Client, func(), error) {
	ctx = desktopNonNilContext(ctx)
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil, nil, errors.New("server id is required")
	}

	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if client, ok := s.getAuthenticatedSSHClient(serverID); ok {
		return client, func() {}, nil
	}

	if credential, hasCredential := s.serverService.getTemporaryCredential(serverID); hasCredential {
		return s.openSSHClientWithCredentialContext(ctx, serverID, credential)
	}

	return s.openSSHClientWithCredentialContext(ctx, serverID, nil)
}

func (s *DesktopSFTPService) openClient(serverID string) (*sftp.Client, func(), error) {
	return s.openClientContext(context.Background(), serverID)
}

func (s *DesktopSFTPService) openClientContext(ctx context.Context, serverID string) (*sftp.Client, func(), error) {
	ctx = desktopNonNilContext(ctx)
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil, nil, errors.New("server id is required")
	}

	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if sshClient, ok := s.getAuthenticatedSSHClient(serverID); ok {
		sftpClient, err := sftp.NewClient(sshClient)
		if err != nil {
			s.clearAuthenticatedSSHClient(serverID)
			return nil, nil, err
		}
		return sftpClient, func() {
			_ = sftpClient.Close()
		}, nil
	}

	if credential, hasCredential := s.serverService.getTemporaryCredential(serverID); hasCredential {
		return s.openClientWithCredentialContext(ctx, serverID, credential)
	}

	return s.openClientWithCredentialContext(ctx, serverID, nil)
}

func (s *DesktopSFTPService) openClientForTransfer(serverID string, credential *DesktopSSHCredential) (*sftp.Client, func(), error) {
	if credential == nil {
		return s.openClient(serverID)
	}

	client, closer, err := s.openClientWithCredential(serverID, credential)
	if err != nil {
		return nil, nil, err
	}

	s.clearAuthenticatedSSHClient(serverID)
	s.serverService.setTemporaryCredential(serverID, *credential)
	return client, closer, nil
}

func (s *DesktopSFTPService) openSSHClientWithCredential(serverID string, credential *DesktopSSHCredential) (*ssh.Client, func(), error) {
	return s.openSSHClientWithCredentialContext(context.Background(), serverID, credential)
}

func (s *DesktopSFTPService) openSSHClientWithCredentialContext(ctx context.Context, serverID string, credential *DesktopSSHCredential) (*ssh.Client, func(), error) {
	ctx = desktopNonNilContext(ctx)
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil, nil, errors.New("server id is required")
	}

	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	server, err := s.serverService.getByIDRaw(serverID)
	if err != nil {
		return nil, nil, err
	}

	authMethods, err := buildDesktopServerSSHAuthMethodsWithCredential(server, credential)
	if err != nil {
		return nil, nil, err
	}
	if len(authMethods) == 0 {
		return nil, nil, errors.New("server credential is required")
	}

	config := &ssh.ClientConfig{
		User:            server.Username,
		Auth:            authMethods,
		HostKeyCallback: desktopHostKeyCallback(),
		Timeout:         12 * time.Second,
	}

	address := net.JoinHostPort(server.Host, strconv.Itoa(server.Port))
	dialer := net.Dialer{Timeout: config.Timeout}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, nil, err
	}

	stopHandshakeWatch := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stopHandshakeWatch:
		}
	}()
	sshConn, channels, requests, err := ssh.NewClientConn(conn, address, config)
	close(stopHandshakeWatch)
	if err != nil {
		_ = conn.Close()
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, nil, ctxErr
		}
		return nil, nil, err
	}
	sshClient := ssh.NewClient(sshConn, channels, requests)
	closer := func() {
		_ = sshClient.Close()
	}
	return sshClient, closer, nil
}

func (s *DesktopSFTPService) openClientWithCredential(serverID string, credential *DesktopSSHCredential) (*sftp.Client, func(), error) {
	return s.openClientWithCredentialContext(context.Background(), serverID, credential)
}

func (s *DesktopSFTPService) openClientWithCredentialContext(ctx context.Context, serverID string, credential *DesktopSSHCredential) (*sftp.Client, func(), error) {
	ctx = desktopNonNilContext(ctx)
	sshClient, sshCloser, err := s.openSSHClientWithCredentialContext(ctx, serverID, credential)
	if err != nil {
		return nil, nil, err
	}

	if err := ctx.Err(); err != nil {
		sshCloser()
		return nil, nil, err
	}
	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		sshCloser()
		return nil, nil, err
	}

	closer := func() {
		_ = sftpClient.Close()
		sshCloser()
	}
	return sftpClient, closer, nil
}

func desktopNonNilContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

func desktopSFTPContextCloser(ctx context.Context, closer func()) func() {
	ctx = desktopNonNilContext(ctx)
	var once sync.Once
	var stopOnce sync.Once
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			once.Do(closer)
		case <-done:
		}
	}()
	return func() {
		once.Do(closer)
		stopOnce.Do(func() {
			close(done)
		})
	}
}

func desktopSFTPStat(client *sftp.Client, remotePath string) (DesktopSFTPFileInfo, error) {
	info, err := client.Lstat(remotePath)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	linkTarget := ""
	if info.Mode()&os.ModeSymlink != 0 {
		if target, readErr := client.ReadLink(remotePath); readErr == nil {
			linkTarget = target
		}
	}

	return desktopSFTPFileInfoFromFileInfo(remotePath, info, linkTarget), nil
}

func desktopSFTPFileInfoFromFileInfo(remotePath string, info os.FileInfo, linkTarget string) DesktopSFTPFileInfo {
	mode := info.Mode()
	return DesktopSFTPFileInfo{
		Name:       info.Name(),
		Path:       sftputil.NormalizePath(remotePath),
		Size:       info.Size(),
		Mode:       uint32(mode.Perm()),
		ModTime:    info.ModTime().UTC().Format(time.RFC3339Nano),
		IsDir:      info.IsDir(),
		IsLink:     mode&os.ModeSymlink != 0,
		LinkTarget: linkTarget,
		Permission: sftputil.PermissionString(mode),
	}
}

func removeDesktopSFTPDirectory(client *sftp.Client, remotePath string) error {
	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}

		childPath := sftputil.JoinPath(remotePath, name)
		if entry.IsDir() && entry.Mode()&os.ModeSymlink == 0 {
			if err := removeDesktopSFTPDirectory(client, childPath); err != nil {
				return err
			}
			continue
		}

		if err := client.Remove(childPath); err != nil {
			return err
		}
	}

	return client.RemoveDirectory(remotePath)
}

func normalizeDesktopSFTPBatchDownloadMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "fast") {
		return "fast"
	}
	return "compatible"
}

func normalizeDesktopSFTPExcludePatterns(patterns []string) []string {
	normalized := make([]string, 0, len(patterns))
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		normalized = append(normalized, pattern)
	}
	return normalized
}

func shouldExcludeDesktopSFTPDir(dirName string, excludePatterns []string) bool {
	for _, pattern := range excludePatterns {
		if dirName == pattern {
			return true
		}
	}
	return false
}

func addDesktopSFTPExcludedPlaceholder(zipWriter *zip.Writer, archivePath string) error {
	placeholderPath := strings.TrimRight(strings.ReplaceAll(archivePath, "\\", "/"), "/") + "/.excluded"
	writer, err := zipWriter.Create(placeholderPath)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(writer, "Excluded directory: %s\nReason: matched exclude pattern\n", path.Base(archivePath))
	return err
}

func buildDesktopSFTPTarCommand(remotePaths []string, excludePatterns []string) string {
	parts := []string{"tar -czf -"}
	for _, pattern := range excludePatterns {
		parts = append(parts, " --exclude="+desktopSFTPShellQuote(pattern))
	}

	for _, remotePath := range remotePaths {
		parentDir, baseName := splitDesktopSFTPTarPath(remotePath)
		parts = append(parts, fmt.Sprintf(" -C %s %s", desktopSFTPShellQuote(parentDir), desktopSFTPShellQuote(baseName)))
	}
	return strings.Join(parts, "")
}

func splitDesktopSFTPTarPath(remotePath string) (string, string) {
	remotePath = sftputil.NormalizePath(remotePath)
	lastSlash := strings.LastIndex(remotePath, "/")
	switch {
	case remotePath == "/":
		return "/", "."
	case lastSlash < 0:
		return ".", remotePath
	case lastSlash == 0:
		return "/", remotePath[1:]
	default:
		return remotePath[:lastSlash], remotePath[lastSlash+1:]
	}
}

func desktopSFTPShellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func addDesktopSFTPZipEntry(
	client *sftp.Client,
	zipWriter *zip.Writer,
	remotePath string,
	archivePath string,
	excludePatterns []string,
	onProgress desktopSFTPProgressCallback,
) (int, error) {
	info, err := client.Lstat(remotePath)
	if err != nil {
		return 0, err
	}

	archivePath = strings.TrimPrefix(strings.ReplaceAll(archivePath, "\\", "/"), "/")
	if archivePath == "" || archivePath == "." {
		archivePath = info.Name()
	}

	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		excludedCount := 0
		dirHeader, err := zip.FileInfoHeader(info)
		if err != nil {
			return 0, err
		}
		dirHeader.Name = strings.TrimRight(archivePath, "/") + "/"
		dirHeader.Method = zip.Deflate
		if _, err := zipWriter.CreateHeader(dirHeader); err != nil {
			return 0, err
		}

		entries, err := client.ReadDir(remotePath)
		if err != nil {
			return 0, err
		}
		for _, entry := range entries {
			name := entry.Name()
			if name == "." || name == ".." {
				continue
			}

			childRemotePath := sftputil.JoinPath(remotePath, name)
			childArchivePath := strings.TrimRight(archivePath, "/") + "/" + name
			if entry.IsDir() && entry.Mode()&os.ModeSymlink == 0 && shouldExcludeDesktopSFTPDir(name, excludePatterns) {
				if err := addDesktopSFTPExcludedPlaceholder(zipWriter, childArchivePath); err != nil {
					return excludedCount, err
				}
				excludedCount++
				continue
			}

			excluded, err := addDesktopSFTPZipEntry(client, zipWriter, childRemotePath, childArchivePath, excludePatterns, onProgress)
			excludedCount += excluded
			if err != nil {
				return excludedCount, err
			}
		}
		return excludedCount, nil
	}

	if info.Mode()&os.ModeSymlink != 0 {
		return 0, nil
	}

	remoteFile, err := client.Open(remotePath)
	if err != nil {
		return 0, err
	}
	defer remoteFile.Close()

	fileHeader, err := zip.FileInfoHeader(info)
	if err != nil {
		return 0, err
	}
	fileHeader.Name = archivePath
	fileHeader.Method = zip.Deflate

	archiveFile, err := zipWriter.CreateHeader(fileHeader)
	if err != nil {
		return 0, err
	}

	var lastLoaded int64
	reader := newDesktopSFTPProgressReader(remoteFile, info.Size(), func(loaded int64, _ int64) error {
		if onProgress == nil {
			return nil
		}
		delta := loaded - lastLoaded
		lastLoaded = loaded
		if delta <= 0 {
			return nil
		}
		return onProgress(delta)
	})
	_, err = io.Copy(archiveFile, reader)
	return 0, err
}

type desktopSFTPTransferStats struct {
	FilesCopied int
	BytesCopied int64
}

type desktopSFTPProgressCallback func(copied int64) error
type desktopSFTPCancelCheck func() bool

func copyDesktopSFTPPath(
	sourceClient *sftp.Client,
	targetClient *sftp.Client,
	sourcePath string,
	targetPath string,
	sourceInfo os.FileInfo,
	isCancelled desktopSFTPCancelCheck,
	onProgress desktopSFTPProgressCallback,
) (desktopSFTPTransferStats, error) {
	stats := desktopSFTPTransferStats{}
	if sourceInfo.IsDir() {
		targetDir := sftputil.JoinPath(targetPath, sourceInfo.Name())
		if err := copyDesktopSFTPDirectory(sourceClient, targetClient, sourcePath, targetDir, &stats, isCancelled, onProgress); err != nil {
			return desktopSFTPTransferStats{}, err
		}
		return stats, nil
	}

	targetFilePath := targetPath
	if targetInfo, err := targetClient.Stat(targetPath); err == nil && targetInfo.IsDir() {
		targetFilePath = sftputil.JoinPath(targetPath, path.Base(sourcePath))
	}
	if err := copyDesktopSFTPFile(sourceClient, targetClient, sourcePath, targetFilePath, sourceInfo, &stats, isCancelled, onProgress); err != nil {
		return desktopSFTPTransferStats{}, err
	}

	return stats, nil
}

func copyDesktopSFTPDirectory(
	sourceClient *sftp.Client,
	targetClient *sftp.Client,
	sourceDir string,
	targetDir string,
	stats *desktopSFTPTransferStats,
	isCancelled desktopSFTPCancelCheck,
	onProgress desktopSFTPProgressCallback,
) error {
	if isCancelled != nil && isCancelled() {
		return errDesktopSFTPTaskCancelled
	}
	if err := targetClient.MkdirAll(targetDir); err != nil {
		return fmt.Errorf("failed to create target directory: %w", err)
	}

	entries, err := sourceClient.ReadDir(sourceDir)
	if err != nil {
		return fmt.Errorf("failed to read source directory: %w", err)
	}

	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}

		childSourcePath := sftputil.JoinPath(sourceDir, name)
		childTargetPath := sftputil.JoinPath(targetDir, name)
		if entry.IsDir() && entry.Mode()&os.ModeSymlink == 0 {
			if err := copyDesktopSFTPDirectory(sourceClient, targetClient, childSourcePath, childTargetPath, stats, isCancelled, onProgress); err != nil {
				return err
			}
			continue
		}

		if err := copyDesktopSFTPFile(sourceClient, targetClient, childSourcePath, childTargetPath, entry, stats, isCancelled, onProgress); err != nil {
			return err
		}
	}

	return nil
}

func copyDesktopSFTPFile(
	sourceClient *sftp.Client,
	targetClient *sftp.Client,
	sourcePath string,
	targetPath string,
	sourceInfo os.FileInfo,
	stats *desktopSFTPTransferStats,
	isCancelled desktopSFTPCancelCheck,
	onProgress desktopSFTPProgressCallback,
) error {
	if isCancelled != nil && isCancelled() {
		return errDesktopSFTPTaskCancelled
	}
	remoteFile, err := sourceClient.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer remoteFile.Close()

	targetFile, err := targetClient.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("failed to create target file: %w", err)
	}

	reader := newDesktopSFTPProgressReader(remoteFile, sourceInfo.Size(), func(loaded int64, _ int64) error {
		if isCancelled != nil && isCancelled() {
			return errDesktopSFTPTaskCancelled
		}
		if onProgress == nil {
			return nil
		}
		return onProgress(stats.BytesCopied + loaded)
	})
	copied, copyErr := io.Copy(targetFile, reader)
	closeErr := targetFile.Close()
	if copyErr != nil {
		return fmt.Errorf("failed to copy file: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("failed to close target file: %w", closeErr)
	}

	_ = targetClient.Chmod(targetPath, sourceInfo.Mode().Perm())
	stats.FilesCopied++
	stats.BytesCopied += copied
	return nil
}

func desktopSFTPPathSize(client *sftp.Client, remotePath string, info os.FileInfo) (int64, error) {
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return info.Size(), nil
	}

	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return 0, fmt.Errorf("failed to read source directory: %w", err)
	}

	var total int64
	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}
		childPath := sftputil.JoinPath(remotePath, name)
		size, err := desktopSFTPPathSize(client, childPath, entry)
		if err != nil {
			return 0, err
		}
		total += size
	}
	return total, nil
}

func desktopSFTPPathsSize(client *sftp.Client, remotePaths []string, excludePatterns []string) (int64, error) {
	var total int64
	for _, remotePath := range remotePaths {
		info, err := client.Lstat(remotePath)
		if err != nil {
			return 0, err
		}
		size, err := desktopSFTPPathSizeWithExclude(client, remotePath, info, excludePatterns)
		if err != nil {
			return 0, err
		}
		total += size
	}
	return total, nil
}

func desktopSFTPPathSizeWithExclude(client *sftp.Client, remotePath string, info os.FileInfo, excludePatterns []string) (int64, error) {
	if info.Mode()&os.ModeSymlink != 0 {
		return 0, nil
	}
	if !info.IsDir() {
		return info.Size(), nil
	}

	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return 0, fmt.Errorf("failed to read source directory: %w", err)
	}

	var total int64
	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}
		if entry.IsDir() && entry.Mode()&os.ModeSymlink == 0 && shouldExcludeDesktopSFTPDir(name, excludePatterns) {
			continue
		}
		childPath := sftputil.JoinPath(remotePath, name)
		size, err := desktopSFTPPathSizeWithExclude(client, childPath, entry, excludePatterns)
		if err != nil {
			return 0, err
		}
		total += size
	}
	return total, nil
}

type desktopSFTPProgressReader struct {
	reader     io.Reader
	total      int64
	loaded     int64
	onProgress func(loaded int64, total int64) error
}

func newDesktopSFTPProgressReader(reader io.Reader, total int64, onProgress func(loaded int64, total int64) error) io.Reader {
	return &desktopSFTPProgressReader{
		reader:     reader,
		total:      total,
		onProgress: onProgress,
	}
}

func (r *desktopSFTPProgressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		r.loaded += int64(n)
		if r.onProgress != nil {
			if progressErr := r.onProgress(r.loaded, r.total); progressErr != nil {
				return n, progressErr
			}
		}
	}
	return n, err
}

type desktopSFTPProgressWriter struct {
	writer     io.Writer
	total      int64
	loaded     int64
	onProgress func(loaded int64, total int64) error
}

func newDesktopSFTPProgressWriter(writer io.Writer, total int64, onProgress func(loaded int64, total int64) error) io.Writer {
	return &desktopSFTPProgressWriter{
		writer:     writer,
		total:      total,
		onProgress: onProgress,
	}
}

func (w *desktopSFTPProgressWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	if n > 0 {
		w.loaded += int64(n)
		if w.onProgress != nil {
			if progressErr := w.onProgress(w.loaded, w.total); progressErr != nil {
				return n, progressErr
			}
		}
	}
	return n, err
}

func desktopSFTPBatchError(remotePath string, err error) DesktopSFTPBatchOperationError {
	message := err.Error()
	return DesktopSFTPBatchOperationError{
		Path:    remotePath,
		Error:   message,
		Message: message,
	}
}

func desktopSFTPProgressPercent(loaded int64, total int64) int {
	if total <= 0 {
		return 0
	}
	percent := int(float64(loaded) / float64(total) * 100)
	if percent < 0 {
		return 0
	}
	if percent > 100 {
		return 100
	}
	return percent
}

func desktopSFTPBlocksToBytes(blockSize uint64, blocks uint64) int64 {
	const maxInt64Uint = uint64(^uint64(0) >> 1)
	if blockSize == 0 || blocks == 0 {
		return 0
	}
	if blockSize > maxInt64Uint/blocks {
		return int64(maxInt64Uint)
	}
	return int64(blockSize * blocks)
}

func firstNonEmptyDesktopSFTP(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
