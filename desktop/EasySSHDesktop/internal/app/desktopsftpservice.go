package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const desktopSFTPMaxTextBytes = sftputil.MaxTextFileBytes

const desktopSFTPTaskCenterProgressInterval = 500 * time.Millisecond

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
	Operation           *DesktopSFTPChangeResult `json:"operation,omitempty"`
	MetadataUnavailable bool                     `json:"metadata_unavailable,omitempty"`
	RefreshError        string                   `json:"refresh_error,omitempty"`
	Name                string                   `json:"name"`
	Path                string                   `json:"path"`
	Size                int64                    `json:"size"`
	Mode                uint32                   `json:"mode"`
	ModTime             string                   `json:"mod_time"`
	IsDir               bool                     `json:"is_dir"`
	IsLink              bool                     `json:"is_link"`
	LinkTarget          string                   `json:"link_target,omitempty"`
	Permission          string                   `json:"permission,omitempty"`
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
	Operation *DesktopSFTPChangeResult         `json:"operation,omitempty"`
	Effects   DesktopSFTPDeleteEffects         `json:"effects"`
	Success   []string                         `json:"success"`
	Failed    []DesktopSFTPBatchOperationError `json:"failed"`
	Total     int                              `json:"total"`
}

type desktopSFTPTaskStatus struct {
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
	desktopSFTPTaskUpload      desktopSFTPTaskKind = "upload"
	desktopSFTPTaskDownload    desktopSFTPTaskKind = "download"
	desktopSFTPTaskTransfer    desktopSFTPTaskKind = "transfer"
	desktopSFTPTaskDelete      desktopSFTPTaskKind = "delete"
	desktopSFTPTaskDeleteEntry desktopSFTPTaskKind = "delete_entry"
	desktopSFTPTaskMkdir       desktopSFTPTaskKind = "mkdir"
	desktopSFTPTaskRename      desktopSFTPTaskKind = "rename"
	desktopSFTPTaskChmod       desktopSFTPTaskKind = "chmod"
	desktopSFTPTaskWrite       desktopSFTPTaskKind = "write"
)

var errDesktopSFTPTaskCancelled = errors.New("transfer cancelled")

type desktopSFTPTask struct {
	desktopSFTPTaskStatus
	kind                desktopSFTPTaskKind
	createdAt           time.Time
	startedAt           time.Time
	endedAt             time.Time
	cancelled           bool
	cancel              context.CancelFunc
	committedFiles      int
	detailJSON          string
	settling            bool
	taskCenterUpdatedAt time.Time
}

type desktopSFTPAuthenticatedSSHClient struct {
	client          *ssh.Client
	close           func()
	authenticatedAt time.Time
	revision        int64
	users           int
	idleTimer       *time.Timer
	idleGeneration  uint64
	idleSFTP        []*desktopSFTPBrowserClient
}

type DesktopSFTPService struct {
	desktopOperationRegistry
	serverService        *DesktopServerService
	activity             *ActivityLogService
	taskCenter           *DesktopTaskService
	taskMu               sync.Mutex
	tasks                map[string]*desktopSFTPTask
	authenticatedMu      sync.Mutex
	authenticatedVersion uint64
	authenticatedSSH     map[string]*desktopSFTPAuthenticatedSSHClient
}

func NewDesktopSFTPService(serverService *DesktopServerService, taskCenter *DesktopTaskService, activity *ActivityLogService) *DesktopSFTPService {
	service := &DesktopSFTPService{
		serverService:    serverService,
		activity:         activity,
		taskCenter:       taskCenter,
		tasks:            make(map[string]*desktopSFTPTask),
		authenticatedSSH: make(map[string]*desktopSFTPAuthenticatedSSHClient),
	}
	if taskCenter != nil {
		for _, taskType := range []string{"sftp_upload", "sftp_download", "sftp_transfer", "sftp_recursive_delete", "sftp_delete", "sftp_mkdir", "sftp_rename", "sftp_chmod", "sftp_write"} {
			taskCenter.registerHandler(taskType, service)
		}
	}
	return service
}

func (s *DesktopSFTPService) createTask(kind desktopSFTPTaskKind, taskID string, fileName string, fileSize int64, serverID string, remotePath string, retryOfID string, attempt int, resources ...activitystats.Resource) (string, error) {
	return s.createTaskWithContext(context.Background(), kind, taskID, fileName, fileSize, serverID, remotePath, retryOfID, attempt, resources...)
}

func (s *DesktopSFTPService) createTaskWithContext(ctx context.Context, kind desktopSFTPTaskKind, taskID string, fileName string, fileSize int64, serverID string, remotePath string, retryOfID string, attempt int, resources ...activitystats.Resource) (string, error) {
	return s.createTaskWithIntent(ctx, kind, taskID, fileName, fileSize, serverID, remotePath, retryOfID, attempt, nil, resources...)
}

func (s *DesktopSFTPService) createTaskWithIntent(ctx context.Context, kind desktopSFTPTaskKind, taskID string, fileName string, fileSize int64, serverID string, remotePath string, retryOfID string, attempt int, intent *desktopTransferIntent, resources ...activitystats.Resource) (string, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return "", errors.New("server id is required")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		taskID = uuid.NewString()
	}
	now := time.Now().UTC()
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	s.pruneSettledTasksLocked(now)
	existing := s.tasks[taskID]
	if existing == nil && len(s.tasks) >= 128 {
		oldestID := ""
		var oldestTime time.Time
		for id, task := range s.tasks {
			if task.EndedAt != "" && !task.settling && (oldestID == "" || task.endedAt.Before(oldestTime)) {
				oldestID, oldestTime = id, task.endedAt
			}
		}
		if oldestID == "" {
			return "", errors.New("file task capacity reached")
		}
		delete(s.tasks, oldestID)
	}
	if existing != nil {
		return "", errors.New("task already exists")
	}
	if err := s.syncTaskCenterTask(ctx, kind, taskID, fileSize, serverID, remotePath, retryOfID, attempt, intent, resources); err != nil {
		return "", err
	}
	s.tasks[taskID] = &desktopSFTPTask{kind: kind, createdAt: now, desktopSFTPTaskStatus: desktopSFTPTaskStatus{
		ID: taskID, Type: string(kind), FileName: fileName, FileSize: fileSize, ServerID: serverID, RemotePath: remotePath,
		Status: "pending", Stage: "stream", Total: fileSize, CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}}
	return taskID, nil
}

func (s *DesktopSFTPService) syncTaskCenterTask(ctx context.Context, kind desktopSFTPTaskKind, taskID string, fileSize int64, serverID string, remotePath string, retryOfID string, attempt int, intent *desktopTransferIntent, resources []activitystats.Resource) error {
	transfer := kind == desktopSFTPTaskUpload || kind == desktopSFTPTaskDownload || kind == desktopSFTPTaskTransfer
	if transfer != (intent != nil) {
		return errors.New("transfer intent required")
	}
	sourceType := "desktop_sftp"
	if transfer {
		sourceType = "transfer_job"
	}
	if s.taskCenter == nil {
		return errors.New("task center unavailable")
	}
	bytesTotal := fileSize
	if kind == desktopSFTPTaskDelete || kind == desktopSFTPTaskDeleteEntry {
		bytesTotal = 0
	}
	parent, _ := ctx.Value(desktopAIExecutionContextKey{}).(desktopAIExecutionParent)
	actor := desktopLocalActor()
	if parent.ID != "" {
		actor = parent.Actor
	}
	_, err := s.taskCenter.create(desktopTaskCreateInput{Transfer: intent, ParentWorkID: parent.ID, Resources: resources, Actor: actor, RetryOfID: retryOfID, Attempt: attempt, ID: taskID, TaskType: desktopSFTPTaskCenterType(kind), Title: desktopSFTPTaskCenterTitle(kind),
		SourceType: sourceType, SourceID: taskID, ServerID: serverID, Resource: remotePath, TotalCount: desktopSFTPTaskTotalCount(kind, fileSize), BytesTotal: bytesTotal, Cancelable: true, Retryable: kind == desktopSFTPTaskDelete})
	return err
}

func (s *DesktopSFTPService) startTask(taskID string, status string, total int64) error {
	now := time.Now().UTC()

	s.taskMu.Lock()
	task, ok := s.tasks[taskID]
	if !ok {
		s.taskMu.Unlock()
		return errors.New("task not found")
	}
	if task.cancelled || task.Status == "cancelled" {
		s.taskMu.Unlock()
		s.finishCanceledTask(taskID, 0, 0)
		return errDesktopSFTPTaskCancelled
	}
	if !task.startedAt.IsZero() || task.EndedAt != "" {
		s.taskMu.Unlock()
		return errors.New("task already started")
	}
	if s.taskCenter == nil {
		s.taskMu.Unlock()
		return errors.New("task center unavailable")
	}
	if err := s.taskCenter.start(taskID, task.Stage); err != nil {
		s.taskMu.Unlock()
		return err
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
	s.taskMu.Unlock()
	return nil
}

func (s *DesktopSFTPService) updateTaskProgress(taskID string, loaded int64, total int64, stage string) error {
	now := time.Now().UTC()

	s.taskMu.Lock()
	task, ok := s.tasks[taskID]
	if !ok {
		s.taskMu.Unlock()
		return nil
	}
	if task.EndedAt != "" {
		s.taskMu.Unlock()
		return errors.New("task already finished")
	}
	cancelled := task.cancelled || task.Status == "cancelled"
	previousTotal := task.Total
	previousStage := task.Stage
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
	progress, taskStage := task.Progress, task.Stage
	kind := task.kind
	completedFiles := task.committedFiles
	loaded, taskTotal := task.Loaded, task.Total
	shouldSyncTaskCenter := s.taskCenter != nil && (task.taskCenterUpdatedAt.IsZero() ||
		now.Sub(task.taskCenterUpdatedAt) >= desktopSFTPTaskCenterProgressInterval ||
		(previousTotal <= 0 && taskTotal > 0) ||
		previousStage != taskStage ||
		progress >= 100)
	if shouldSyncTaskCenter {
		task.taskCenterUpdatedAt = now
	}
	s.taskMu.Unlock()
	// A writer has already accepted these bytes. Even if cancellation arrived
	// during the write, keep its last receipt in the final attempted-byte total.
	if cancelled {
		return errDesktopSFTPTaskCancelled
	}
	if shouldSyncTaskCenter {
		if kind == desktopSFTPTaskDelete {
			loaded, taskTotal = 0, 0
		}
		return s.taskCenter.updateProgress(taskID, progress, taskStage, loaded, taskTotal, completedFiles, 0)
	}
	return nil
}

func (s *DesktopSFTPService) completeTask(taskID string, message string) error {
	return s.completeTaskOutcome(taskID, "succeeded", message, 1, 0)
}

func (s *DesktopSFTPService) completeTaskOutcome(taskID, status, message string, successCount, failureCount int) error {
	completed := int64(0)
	if status == "succeeded" {
		completed = -1
	}
	return s.settleTask(taskID, status, message, "", successCount, failureCount, completed)
}

func (s *DesktopSFTPService) failTask(taskID string, err error) error {
	failures := 1
	if errors.Is(err, errDesktopSFTPCommitUnknown) || errors.Is(err, errDesktopSFTPDeleteUnknown) || errors.Is(err, errDesktopSFTPTaskCancelled) || errors.Is(err, context.Canceled) {
		failures = 0
	}
	return s.failTaskOutcome(taskID, err, 0, failures, 0)
}

func (s *DesktopSFTPService) failTaskOutcome(taskID string, err error, successCount, failureCount int, completed int64) error {
	if errors.Is(err, errDesktopSFTPCommitUnknown) || errors.Is(err, errDesktopSFTPDeleteUnknown) {
		code := "remote_commit_unknown"
		if errors.Is(err, errDesktopSFTPDeleteUnknown) {
			code = "remote_delete_unknown"
		}
		return s.settleTask(taskID, "unknown", err.Error(), code, successCount, failureCount, completed)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return s.settleTask(taskID, "timeout", err.Error(), "sftp_timeout", successCount, failureCount, completed)
	}
	if errors.Is(err, errDesktopSFTPTaskCancelled) || errors.Is(err, context.Canceled) {
		return s.settleTask(taskID, "canceled", "执行已停止，取消前完成的操作保留", "", successCount, failureCount, completed)
	}
	message := ""
	if err != nil {
		message = err.Error()
	}
	status := "failed"
	if successCount > 0 {
		status = "partial_success"
	}
	return s.settleTask(taskID, status, message, "sftp_failed", successCount, failureCount, completed)
}

func (s *DesktopSFTPService) settleTask(taskID, status, message, errorCode string, successCount, failureCount int, completed int64) error {
	now := time.Now().UTC()
	s.taskMu.Lock()
	task, ok := s.tasks[taskID]
	if !ok || task.EndedAt != "" {
		s.taskMu.Unlock()
		return nil
	}
	processed, total := task.Loaded, task.Total
	if task.kind == desktopSFTPTaskDelete || task.kind == desktopSFTPTaskDeleteEntry {
		processed, total, completed = 0, 0, 0
	}
	if completed < 0 {
		completed = processed
	}
	switch status {
	case "succeeded", "partial_success":
		task.Status = "completed"
		task.Progress = 100
	case "unknown":
		task.Status = "unknown"
	case "canceled":
		task.Status = "cancelled"
		task.cancelled = true
	default:
		task.Status = "failed"
	}
	task.Message = message
	if status != "succeeded" {
		task.Error = message
	}
	task.endedAt = now
	task.settling = true
	task.EndedAt, task.UpdatedAt = now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)
	bound := task.ServerID != ""
	detailJSON := task.detailJSON
	s.taskMu.Unlock()
	defer func() {
		s.taskMu.Lock()
		task.settling = false
		s.taskMu.Unlock()
	}()
	if s.taskCenter != nil && bound {
		resultData := map[string]any{"message": message, "success_count": successCount, "failure_count": failureCount}
		if detailJSON != "" {
			resultData["details"] = json.RawMessage(detailJSON)
		}
		result, _ := json.Marshal(resultData)
		outcome := desktopTaskCompletion{Status: status, ResultJSON: string(result), ErrorCode: errorCode, SuccessCount: successCount, FailureCount: failureCount, FinishedAt: now.Format(time.RFC3339Nano), Metrics: &desktopTaskFinalMetrics{Processed: processed, Total: total, Completed: completed}}
		if status != "succeeded" {
			outcome.ErrorMessage = message
		}
		if err := s.taskCenter.completeOutcome(taskID, outcome); err != nil {
			desktopLogPrintf("SFTP result storage failed: task=%s error=%v", taskID, err)
			return err
		}
	}
	return nil
}

func desktopSFTPTaskCenterType(kind desktopSFTPTaskKind) string {
	switch kind {
	case desktopSFTPTaskUpload:
		return "sftp_upload"
	case desktopSFTPTaskDownload:
		return "sftp_download"
	case desktopSFTPTaskDelete:
		return "sftp_recursive_delete"
	case desktopSFTPTaskDeleteEntry:
		return "sftp_delete"
	case desktopSFTPTaskMkdir:
		return "sftp_mkdir"
	case desktopSFTPTaskRename:
		return "sftp_rename"
	case desktopSFTPTaskChmod:
		return "sftp_chmod"
	case desktopSFTPTaskWrite:
		return "sftp_write"
	default:
		return "sftp_transfer"
	}
}

func desktopSFTPTaskCenterTitle(kind desktopSFTPTaskKind) string {
	switch kind {
	case desktopSFTPTaskUpload:
		return "SFTP 上传"
	case desktopSFTPTaskDownload:
		return "SFTP 下载"
	case desktopSFTPTaskDelete:
		return "SFTP 递归删除"
	case desktopSFTPTaskDeleteEntry:
		return "SFTP 删除"
	case desktopSFTPTaskMkdir:
		return "SFTP 创建目录"
	case desktopSFTPTaskRename:
		return "SFTP 重命名"
	case desktopSFTPTaskChmod:
		return "SFTP 修改权限"
	case desktopSFTPTaskWrite:
		return "SFTP 保存文件"
	default:
		return "SFTP 跨服务器传输"
	}
}

func desktopSFTPTaskTotalCount(kind desktopSFTPTaskKind, total int64) int {
	if (kind == desktopSFTPTaskDelete || kind == desktopSFTPTaskDeleteEntry) && total > 0 {
		return int(total)
	}
	return 1
}

// Request cancellation first. Only the worker that observes cancellation (or
// a task that has not started) can record a canceled result.
func (s *DesktopSFTPService) cancelTask(taskID string, kind desktopSFTPTaskKind) error {
	taskID = strings.TrimSpace(taskID)
	s.taskMu.Lock()
	task, ok := s.tasks[taskID]
	if !ok || task.kind != kind {
		s.taskMu.Unlock()
		return errors.New("task not found")
	}
	if task.EndedAt != "" {
		s.taskMu.Unlock()
		return nil
	}
	task.cancelled = true
	task.Status = "canceling"
	task.Message = "已请求取消"
	task.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	unstarted := task.startedAt.IsZero()
	cancel := task.cancel
	bound := task.ServerID != ""
	s.taskMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if s.taskCenter != nil && bound {
		if _, err := s.taskCenter.requestCancel(taskID); err != nil {
			desktopLogPrintf("SFTP cancellation accepted; request persistence failed: %s", taskID)
		}
	}
	if unstarted {
		s.finishCanceledTask(taskID, 0, 0)
	}
	return nil
}

func (s *DesktopSFTPService) finishCanceledTask(taskID string, successCount, failureCount int) {
	s.settleTask(taskID, "canceled", "执行已停止，取消前完成的操作保留", "", successCount, failureCount, 0)
}

func (s *DesktopSFTPService) CancelDesktopTask(taskID string) bool {
	s.taskMu.Lock()
	_, exists := s.tasks[strings.TrimSpace(taskID)]
	s.taskMu.Unlock()
	if !exists {
		return false
	}
	return s.cancelAnyTask(taskID) == nil
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

func (s *DesktopSFTPService) pruneSettledTasksLocked(now time.Time) {
	const settledTaskTTL = time.Hour
	for taskID, task := range s.tasks {
		if task.EndedAt == "" || task.endedAt.IsZero() || task.settling {
			continue
		}
		if now.Sub(task.endedAt) > settledTaskTTL {
			delete(s.tasks, taskID)
		}
	}
}

func (s *DesktopSFTPService) Authenticate(input DesktopSFTPAuthenticateInput) error {
	ctx, done, operationErr := s.beginOperation(context.Background())
	if operationErr != nil {
		return operationErr
	}
	defer done()
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
	_, closer, err := s.openClientWithCredentialContext(ctx, serverID, &credential)
	if err != nil {
		return err
	}
	closer()

	s.clearAuthenticatedSSHClient(serverID)
	return nil
}

func (s *DesktopSFTPService) ListDirectory(input DesktopSFTPPathInput) (DesktopSFTPDirectoryListResult, error) {
	return s.ListDirectoryContext(context.Background(), input)
}

func (s *DesktopSFTPService) ListDirectoryContext(ctx context.Context, input DesktopSFTPPathInput) (DesktopSFTPDirectoryListResult, error) {
	ctx, done, operationErr := s.beginOperation(ctx)
	if operationErr != nil {
		return DesktopSFTPDirectoryListResult{}, operationErr
	}
	defer done()
	ctx = desktopNonNilContext(ctx)
	remotePath := sftputil.NormalizePath(input.Path)
	client, closer, err := s.openDirectoryClientContext(ctx, input.ServerID)
	if err != nil {
		return DesktopSFTPDirectoryListResult{}, err
	}
	defer closer()
	stop := sftputil.CloseOnCancel(ctx, client.Close)
	defer stop()

	if err := ctx.Err(); err != nil {
		return DesktopSFTPDirectoryListResult{}, err
	}
	inputPath := input.Path
	if inputPath == "~" || strings.HasPrefix(inputPath, "~/") {
		remotePath, err = client.RealPath(".")
		if err != nil {
			return DesktopSFTPDirectoryListResult{}, err
		}
		remotePath = sftputil.NormalizePath(remotePath + strings.TrimPrefix(inputPath, "~"))
	}
	entries, err := client.ReadDir(remotePath)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return DesktopSFTPDirectoryListResult{}, ctxErr
		}
		return DesktopSFTPDirectoryListResult{}, fmt.Errorf("failed to read directory: %w", err)
	}

	files := make([]DesktopSFTPFileInfo, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}

		fullPath := sftputil.JoinPath(remotePath, name)
		// Link targets are loaded by GetFileInfo when needed.
		files = append(files, desktopSFTPFileInfoFromFileInfo(fullPath, entry, ""))
	}

	return DesktopSFTPDirectoryListResult{
		Path:    remotePath,
		Parent:  sftputil.ParentPath(remotePath),
		Files:   files,
		CanRead: true,
	}, nil
}

func (s *DesktopSFTPService) GetFileInfo(input DesktopSFTPPathInput) (DesktopSFTPFileInfo, error) {
	ctx, done, operationErr := s.beginOperation(context.Background())
	if operationErr != nil {
		return DesktopSFTPFileInfo{}, operationErr
	}
	defer done()
	remotePath := sftputil.NormalizePath(input.Path)
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	return desktopSFTPStat(client, remotePath)
}

func (s *DesktopSFTPService) GetDiskUsage(input DesktopSFTPPathInput) (DesktopSFTPDiskUsageResult, error) {
	ctx, done, operationErr := s.beginOperation(context.Background())
	if operationErr != nil {
		return DesktopSFTPDiskUsageResult{}, operationErr
	}
	defer done()
	remotePath := sftputil.NormalizePath(input.Path)
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return DesktopSFTPDiskUsageResult{}, err
	}
	defer closer()

	stat, err := client.StatVFS(remotePath)
	if err != nil {
		return DesktopSFTPDiskUsageResult{}, err
	}

	usage, err := sftputil.FilesystemUsage(remotePath, stat.Blocks, stat.Bfree, stat.Bavail, stat.Frsize)
	if err != nil {
		return DesktopSFTPDiskUsageResult{}, err
	}
	if usage.Total > uint64(^uint64(0)>>1) {
		return DesktopSFTPDiskUsageResult{}, errors.New("filesystem size exceeds supported range")
	}
	return DesktopSFTPDiskUsageResult{Path: usage.Path, Total: int64(usage.Total), Used: int64(usage.Used), Available: int64(usage.Available), UsagePercent: usage.UsedPercent}, nil
}

func (s *DesktopSFTPService) Delete(input DesktopSFTPPathInput) (snapshot DesktopSFTPFileInfo, err error) {
	return s.DeleteContext(context.Background(), input)
}

func (s *DesktopSFTPService) DeleteContext(ctx context.Context, input DesktopSFTPPathInput) (snapshot DesktopSFTPFileInfo, err error) {
	ctx, done, err := s.beginOperation(ctx)
	if err != nil {
		return snapshot, err
	}
	defer done()
	paths, err := normalizeDesktopSFTPDeletePaths([]string{input.Path})
	if err != nil {
		return snapshot, err
	}
	remotePath := paths[0]
	ctx, taskID, cancel, err := s.beginFileMutation(ctx, desktopSFTPTaskDeleteEntry, input.ServerID, remotePath, 1)
	if err != nil {
		return snapshot, err
	}
	defer cancel()
	var effects DesktopSFTPDeleteEffects
	defer func() {
		successes, failures := 0, 0
		if err == nil {
			successes = 1
		} else {
			failures = 1
		}
		receipt, saveErr := s.finishFileMutation(ctx, taskID, err, successes, failures, 0, 0, map[string]any{"source_path": remotePath, "effects": effects})
		err = errors.Join(err, saveErr)
		snapshot.Operation = &receipt
	}()
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return snapshot, err
	}
	defer closer()
	if err = ctx.Err(); err != nil {
		return snapshot, err
	}
	info, err := client.Lstat(remotePath)
	if err != nil {
		return snapshot, err
	}
	snapshot = desktopSFTPFileInfoFromFileInfo(remotePath, info, "")
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		return snapshot, errors.New("directory deletion must use DeletePaths")
	}
	err = removeDesktopSFTPEntry(ctx, client, remotePath, info, &effects)
	return snapshot, err
}

func (s *DesktopSFTPService) BatchDelete(input DesktopSFTPBatchDeleteInput) (result DesktopSFTPBatchDeleteResult, err error) {
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return result, err
	}
	defer done()
	paths, err := normalizeDesktopSFTPDeletePaths(input.Paths)
	if err != nil {
		return result, err
	}
	input.Paths = paths
	ctx, taskID, cancel, err := s.beginFileMutation(ctx, desktopSFTPTaskDeleteEntry, input.ServerID, strings.Join(paths, ","), int64(len(paths)))
	if err != nil {
		return result, err
	}
	defer cancel()
	defer func() {
		receipt, saveErr := s.finishFileMutation(ctx, taskID, err, len(result.Success), len(result.Failed), 0, 0, desktopSFTPDeleteDetails(paths, result, err))
		err = errors.Join(err, saveErr)
		result.Operation = &receipt
	}()
	return s.batchDelete(ctx, input, false, taskID)
}

func (s *DesktopSFTPService) batchDelete(ctx context.Context, input DesktopSFTPBatchDeleteInput, allowRecursive bool, taskID string) (result DesktopSFTPBatchDeleteResult, err error) {
	normalizedPaths, err := normalizeDesktopSFTPDeletePaths(input.Paths)
	if err != nil {
		return result, err
	}

	result = DesktopSFTPBatchDeleteResult{Success: []string{}, Failed: []DesktopSFTPBatchOperationError{}, Total: len(normalizedPaths)}
	defer func() { s.recordSFTPTaskDetail(taskID, desktopSFTPDeleteDetails(normalizedPaths, result, err)) }()

	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return result, err
	}
	defer closer()
	return s.deletePathsOnClient(ctx, client, normalizedPaths, allowRecursive, taskID)
}

func (s *DesktopSFTPService) DeletePaths(input DesktopSFTPBatchDeleteInput) (protocol.SFTPDeletePathsResult, error) {
	normalizedPaths, err := normalizeDesktopSFTPDeletePaths(input.Paths)
	if err != nil {
		return protocol.SFTPDeletePathsResult{}, err
	}

	input.Paths = normalizedPaths
	taskID, err := s.enqueueRecursiveDelete(input, "", 1)
	if err != nil {
		return protocol.SFTPDeletePathsResult{}, err
	}
	return protocol.SFTPDeletePathsResult{Mode: "recursive_task", DeletedPaths: []string{}, TaskID: taskID}, nil
}

func (s *DesktopSFTPService) enqueueRecursiveDelete(input DesktopSFTPBatchDeleteInput, retryOfID string, attempt int) (string, error) {
	if s.taskCenter == nil {
		return "", errors.New("task center is required for recursive deletion")
	}
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return "", err
	}
	launched := false
	defer func() {
		if !launched {
			done()
		}
	}()
	taskID, err := s.createTask(desktopSFTPTaskDelete, "", fmt.Sprintf("%d items", len(input.Paths)), int64(len(input.Paths)), input.ServerID, strings.Join(input.Paths, ","), retryOfID, attempt)
	if err != nil {
		return "", err
	}
	if s.taskCenter != nil {
		if err := s.taskCenter.setPayload(taskID, input); err != nil {
			s.failTask(taskID, err)
			return "", err
		}
	}
	ctx, cancelTask := s.bindTaskContext(ctx, taskID)
	launched = true
	go func() {
		defer done()
		defer cancelTask()
		if err := s.startTask(taskID, "running", int64(len(input.Paths))); err != nil {
			s.failTask(taskID, err)
			return
		}
		result, err := s.batchDelete(ctx, input, true, taskID)
		err = desktopSFTPOperationError(ctx, err)
		if errors.Is(err, errDesktopSFTPDeleteUnknown) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || errors.Is(err, errDesktopSFTPTaskCancelled) {
			s.failTaskOutcome(taskID, err, len(result.Success), len(result.Failed), 0)
			return
		}
		if err != nil || len(result.Failed) == len(input.Paths) {
			if err == nil {
				err = errors.New("all paths failed to delete")
			}
			if result.Effects.FilesRemoved+result.Effects.DirectoriesRemoved > 0 {
				s.settleTask(taskID, "partial_success", err.Error(), "delete_partial", len(result.Success), len(result.Failed), 0)
			} else {
				s.failTaskOutcome(taskID, err, len(result.Success), len(result.Failed), 0)
			}
			return
		}
		status := "succeeded"
		if len(result.Failed) > 0 {
			status = "partial_success"
		}
		s.completeTaskOutcome(taskID, status, fmt.Sprintf("成功 %d，失败 %d", len(result.Success), len(result.Failed)), len(result.Success), len(result.Failed))
	}()
	return taskID, nil
}

func (s *DesktopSFTPService) RetryDesktopTask(run DesktopTaskRun) (string, error) {
	if run.TaskType != "sftp_recursive_delete" {
		return "", errors.New("task type is not retryable")
	}
	var input DesktopSFTPBatchDeleteInput
	if err := json.Unmarshal([]byte(run.PayloadJSON), &input); err != nil {
		return "", err
	}
	paths, err := normalizeDesktopSFTPDeletePaths(input.Paths)
	if err != nil {
		return "", err
	}
	input.Paths = paths
	return s.enqueueRecursiveDelete(input, run.ID, run.Attempt+1)
}

func normalizeDesktopSFTPDeletePaths(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, errors.New("paths are required")
	}
	if len(paths) > 100 {
		return nil, errors.New("at most 100 paths can be deleted at once")
	}
	normalized := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, remotePath := range paths {
		var err error
		remotePath, err = sftputil.ValidateDeletePath(remotePath)
		if err != nil {
			return nil, err
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
	ctx, done, err := s.beginOperation(ctx)
	if err != nil {
		return info, err
	}
	defer done()
	remotePath, err := desktopSFTPMutationPath(input.Path)
	if err != nil {
		return info, err
	}
	ctx, taskID, cancel, err := s.beginFileMutation(ctx, desktopSFTPTaskMkdir, input.ServerID, remotePath, 0)
	if err != nil {
		return info, err
	}
	defer cancel()
	defer func() {
		successes, failures := 0, 0
		if err == nil {
			successes = 1
		} else {
			failures = 1
		}
		receipt, saveErr := s.finishFileMutation(ctx, taskID, err, successes, failures, 0, 0, map[string]any{"dest_path": remotePath, "refresh_error": info.RefreshError})
		err = errors.Join(err, saveErr)
		info.Operation = &receipt
	}()
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return info, err
	}
	defer closer()
	if err = ctx.Err(); err != nil {
		return info, err
	}
	if err = desktopSFTPMutationError(client.Mkdir(remotePath)); err != nil {
		return info, err
	}
	// A failed metadata refresh cannot undo a confirmed successful MKDIR.
	refreshed, refreshErr := desktopSFTPStat(client, remotePath)
	if refreshErr != nil {
		return DesktopSFTPFileInfo{Name: path.Base(remotePath), Path: remotePath, IsDir: true, MetadataUnavailable: true, RefreshError: refreshErr.Error()}, nil
	}
	return refreshed, nil
}

func (s *DesktopSFTPService) Rename(input DesktopSFTPRenameInput) (info DesktopSFTPFileInfo, err error) {
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return info, err
	}
	defer done()
	oldPath, err := desktopSFTPMutationPath(input.OldPath)
	if err != nil {
		return info, err
	}
	newPath, err := desktopSFTPMutationPath(input.NewPath)
	if err != nil {
		return info, err
	}
	if oldPath == newPath {
		return info, errors.New("source and destination are identical")
	}
	ctx, taskID, cancel, err := s.beginFileMutation(ctx, desktopSFTPTaskRename, input.ServerID, oldPath, 0)
	if err != nil {
		return info, err
	}
	defer cancel()
	defer func() {
		successes, failures := 0, 0
		if err == nil {
			successes = 1
		} else {
			failures = 1
		}
		receipt, saveErr := s.finishFileMutation(ctx, taskID, err, successes, failures, 0, 0, map[string]any{"source_path": oldPath, "dest_path": newPath, "refresh_error": info.RefreshError})
		err = errors.Join(err, saveErr)
		info.Operation = &receipt
	}()
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return info, err
	}
	defer closer()
	if err = ctx.Err(); err != nil {
		return info, err
	}
	if err = desktopSFTPMutationError(client.Rename(oldPath, newPath)); err != nil {
		return info, err
	}
	refreshed, refreshErr := desktopSFTPStat(client, newPath)
	if refreshErr != nil {
		return DesktopSFTPFileInfo{Name: path.Base(newPath), Path: newPath, MetadataUnavailable: true, RefreshError: refreshErr.Error()}, nil
	}
	return refreshed, nil
}

func (s *DesktopSFTPService) ReadFile(input DesktopSFTPPathInput) (string, error) {
	return s.ReadFileContext(context.Background(), input)
}

func (s *DesktopSFTPService) ReadFileContext(ctx context.Context, input DesktopSFTPPathInput) (string, error) {
	ctx, done, operationErr := s.beginOperation(ctx)
	if operationErr != nil {
		return "", operationErr
	}
	defer done()
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
	ctx, done, err := s.beginOperation(ctx)
	if err != nil {
		return info, err
	}
	defer done()
	remotePath, err := desktopSFTPMutationPath(input.Path)
	if err != nil {
		return info, err
	}
	if len(input.Content) > desktopSFTPMaxTextBytes {
		return info, errors.New("file exceeds text write limit")
	}
	ctx, taskID, cancel, err := s.beginFileMutation(ctx, desktopSFTPTaskWrite, input.ServerID, remotePath, int64(len(input.Content)))
	if err != nil {
		return info, err
	}
	defer cancel()
	var processed int64
	defer func() {
		successes, failures := 0, 0
		if err == nil {
			successes = 1
		} else {
			failures = 1
		}
		receipt, saveErr := s.finishFileMutation(ctx, taskID, err, successes, failures, processed, int64(len(input.Content)), map[string]any{"dest_path": remotePath, "bytes_total": len(input.Content), "bytes_processed": processed})
		err = errors.Join(err, saveErr)
		info.Operation = &receipt
	}()
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return info, err
	}
	defer closer()
	return writeDesktopSFTPAtomic(ctx, client, remotePath, 0600, func(file *sftp.File) error {
		var copyErr error
		processed, copyErr = io.Copy(file, strings.NewReader(input.Content))
		return copyErr
	})
}

func (s *DesktopSFTPService) Chmod(input DesktopSFTPChmodInput) (result DesktopSFTPChangeResult, err error) {
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return result, err
	}
	defer done()
	remotePath, err := desktopSFTPMutationPath(input.Path)
	if err != nil {
		return result, err
	}
	mode, err := sftputil.ParsePermissionMode(input.Mode)
	if err != nil {
		return result, fmt.Errorf("invalid chmod mode: %w", err)
	}
	ctx, taskID, cancel, err := s.beginFileMutation(ctx, desktopSFTPTaskChmod, input.ServerID, remotePath, 0)
	if err != nil {
		return result, err
	}
	defer cancel()
	defer func() {
		successes, failures := 0, 0
		if err == nil {
			successes = 1
		} else {
			failures = 1
		}
		var saveErr error
		result, saveErr = s.finishFileMutation(ctx, taskID, err, successes, failures, 0, 0, map[string]any{"source_path": remotePath, "mode": input.Mode})
		err = errors.Join(err, saveErr)
	}()
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return result, err
	}
	defer closer()
	if err = ctx.Err(); err != nil {
		return result, err
	}
	return result, desktopSFTPMutationError(client.Chmod(remotePath, mode))
}

func (s *DesktopSFTPService) UploadFile(input DesktopSFTPUploadFileInput) (info DesktopSFTPFileInfo, err error) {
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return info, err
	}
	defer done()
	fileName := input.FileName
	if fileName == "" || fileName == "." || fileName == ".." || strings.ContainsAny(fileName, "/\x00") {
		return info, errors.New("file name must be a single path component")
	}
	// Renderer uploads are intentionally small; large files belong to native streaming.
	if len(input.Data) > base64.StdEncoding.EncodedLen(desktopSFTPMaxTextBytes) {
		return info, errors.New("renderer upload exceeds 5 MiB limit")
	}
	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		return info, err
	}
	if len(data) > desktopSFTPMaxTextBytes {
		return info, errors.New("renderer upload exceeds 5 MiB limit")
	}
	remotePath := sftputil.JoinPath(input.Path, fileName)
	taskID, err := s.createTransferTask(ctx, input.TaskID, int64(len(data)), desktopTransferIntent{Kind: desktopSFTPTaskUpload, FileName: fileName, TargetServerID: input.ServerID, SourcePaths: []string{fileName}, TargetPath: remotePath, ResultPath: remotePath})
	if err != nil {
		return info, err
	}
	ctx, cancel := s.bindTaskContext(ctx, taskID)
	defer cancel()
	defer func() {
		err = desktopSFTPOperationError(ctx, err)
		if err != nil {
			err = errors.Join(err, s.failTask(taskID, err))
		} else {
			err = s.completeTask(taskID, "Upload completed")
		}
	}()
	if err = s.startTask(taskID, "uploading", int64(len(data))); err != nil {
		return info, err
	}
	client, closer, err := s.openClientContext(ctx, input.ServerID)
	if err != nil {
		return info, err
	}
	defer closer()
	return writeDesktopSFTPAtomic(ctx, client, remotePath, 0600, func(file *sftp.File) error {
		_, err := io.Copy(newDesktopSFTPProgressWriter(file, int64(len(data)), func(loaded, total int64) error {
			return s.updateTaskProgress(taskID, loaded, total, "stream")
		}), bytes.NewReader(data))
		return err
	})
}

func (s *DesktopSFTPService) CancelUploadTask(taskID string) error {
	return s.cancelTask(taskID, desktopSFTPTaskUpload)
}

func (s *DesktopSFTPService) DirectTransfer(input DesktopSFTPDirectTransferInput) (result DesktopSFTPDirectTransferResult, err error) {
	ctx, done, operationErr := s.beginOperation(context.Background())
	if operationErr != nil {
		return DesktopSFTPDirectTransferResult{}, operationErr
	}
	defer done()
	sourceServerID := strings.TrimSpace(input.SourceServerID)
	targetServerID := strings.TrimSpace(input.TargetServerID)
	if sourceServerID == "" {
		return DesktopSFTPDirectTransferResult{}, errors.New("source server id is required")
	}
	if targetServerID == "" {
		return DesktopSFTPDirectTransferResult{}, errors.New("target server id is required")
	}

	selection, err := normalizeDesktopTransferSelection([]string{input.SourcePath}, nil, false)
	if err != nil {
		return result, err
	}
	if !path.IsAbs(input.TargetPath) || len(input.TargetPath) > 4096 || strings.ContainsAny(input.TargetPath, "\\\x00") {
		return result, errors.New("target must be an absolute directory")
	}
	limits, err := s.GetTransferLimits()
	if err != nil {
		return result, err
	}
	sourcePath, targetPath := selection.Paths[0], path.Clean(input.TargetPath)
	if sourceServerID == targetServerID {
		return DesktopSFTPDirectTransferResult{}, errors.New("cannot transfer between the same server")
	}
	taskID := ""
	var totalBytes int64
	var totalFiles int
	var resultPath string
	var stats desktopSFTPTransferStats
	defer func() {
		detail := map[string]any{"task_id": taskID,
			"source_path":      sourcePath,
			"dest_path":        resultPath,
			"file_name":        path.Base(sourcePath),
			"bytes_total":      totalBytes,
			"bytes_completed":  stats.BytesCopied,
			"files_copied":     stats.FilesCopied,
			"source_server_id": sourceServerID,
			"target_server_id": targetServerID,
		}
		if err != nil {
			detail["error"] = err.Error()
		}
		s.recordSFTPTaskDetail(taskID, detail)
		if taskID != "" {
			if err != nil {
				failures := 1
				if errors.Is(err, context.Canceled) || errors.Is(err, errDesktopSFTPTaskCancelled) || errors.Is(err, errDesktopSFTPCommitUnknown) {
					failures = 0
				}
				err = errors.Join(err, s.failTaskOutcome(taskID, err, stats.FilesCopied, failures, stats.BytesCopied))
			} else {
				err = s.completeTaskOutcome(taskID, "succeeded", result.Message, stats.FilesCopied, 0)
			}
		}
		if err != nil {
			result.Success = false
		}
	}()

	taskID, err = s.createTransferTask(ctx, input.TaskID, 0, desktopTransferIntent{Kind: desktopSFTPTaskTransfer, FileName: path.Base(sourcePath), SourceServerID: sourceServerID, TargetServerID: targetServerID, SourcePaths: []string{sourcePath}, TargetPath: targetPath})
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, err
	}
	ctx, cancelTask := s.bindTaskContext(ctx, taskID)
	defer func() {
		if err != nil {
			err = desktopSFTPOperationError(ctx, err)
		}
		cancelTask()
	}()
	err = s.startTask(taskID, "transferring", 0)
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, err
	}

	sourceClient, sourceCloser, err := s.openClientForTransfer(ctx, sourceServerID, input.SourceCredential)
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, fmt.Errorf("failed to connect source server: %w", err)
	}
	defer sourceCloser()

	targetClient, targetCloser, err := s.openClientForTransfer(ctx, targetServerID, input.TargetCredential)
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, fmt.Errorf("failed to connect target server: %w", err)
	}
	defer targetCloser()

	plan, err := planDesktopTransfer(ctx, sourceClient, selection, limits)
	if err != nil {
		return result, err
	}
	totalBytes, totalFiles = plan.bytes, plan.files
	err = s.updateTaskProgress(taskID, 0, totalBytes, "stream")
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, err
	}

	resultPath, err = desktopRelayDestination(ctx, targetClient, targetPath, path.Base(sourcePath), limits.MaxEntries)
	if err != nil {
		return result, err
	}
	if err = s.prepareTransferDestination(taskID, resultPath, totalBytes, totalFiles); err != nil {
		return result, err
	}
	stats, err = copyDesktopSFTPPlan(ctx, sourceClient, targetClient, plan, resultPath, func() bool {
		return s.isTaskCancelled(taskID)
	}, func(copied int64) error {
		return s.updateTaskProgress(taskID, copied, totalBytes, "stream")
	}, func(committed desktopSFTPTransferStats) error { return s.recordTransferCommit(taskID, committed) })
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, err
	}

	message := fmt.Sprintf("Transfer completed: %d file(s), %d byte(s) copied", stats.FilesCopied, stats.BytesCopied)
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

func (s *DesktopSFTPService) setAuthenticatedSSHClient(serverID string, client *ssh.Client, closeClient func(), revision int64, version uint64) error {
	s.operationMu.Lock()
	if s.stopping {
		s.operationMu.Unlock()
		closeClient()
		return errors.New("file service is stopping")
	}
	s.authenticatedMu.Lock()
	if version != s.authenticatedVersion {
		s.authenticatedMu.Unlock()
		s.operationMu.Unlock()
		closeClient()
		return errors.New("file connection was invalidated during authentication; reconnect")
	}
	s.authenticatedVersion++
	existing := s.authenticatedSSH[serverID]
	if existing != nil && existing.idleTimer != nil {
		existing.idleTimer.Stop()
	}
	entry := &desktopSFTPAuthenticatedSSHClient{client: client, close: closeClient, authenticatedAt: time.Now(), revision: revision}
	s.authenticatedSSH[serverID] = entry
	s.operationWG.Add(1)
	go func() { defer s.operationWG.Done(); s.watchAuthenticatedSSHClient(serverID, entry) }()
	s.scheduleAuthenticatedSSHExpiry(serverID, entry)
	s.authenticatedMu.Unlock()
	s.operationMu.Unlock()
	if existing != nil {
		existing.close()
	}
	return nil
}

// 调用方持锁；仅在没有进行中的文件操作时回收空闲连接。
func (s *DesktopSFTPService) scheduleAuthenticatedSSHExpiry(serverID string, entry *desktopSFTPAuthenticatedSSHClient) {
	entry.idleGeneration++
	generation := entry.idleGeneration
	entry.idleTimer = time.AfterFunc(5*time.Minute, func() {
		s.authenticatedMu.Lock()
		if s.authenticatedSSH[serverID] != entry || entry.users != 0 || entry.idleGeneration != generation {
			s.authenticatedMu.Unlock()
			return
		}
		delete(s.authenticatedSSH, serverID)
		s.authenticatedMu.Unlock()
		entry.close()
	})
}

func (s *DesktopSFTPService) acquireAuthenticatedSSHClient(serverID string, revision int64) (*ssh.Client, func(), bool) {
	s.authenticatedMu.Lock()
	entry := s.authenticatedSSH[serverID]
	if entry == nil || entry.client == nil {
		s.authenticatedMu.Unlock()
		return nil, nil, false
	}
	if entry.revision != revision {
		delete(s.authenticatedSSH, serverID)
		s.authenticatedVersion++
		if entry.idleTimer != nil {
			entry.idleTimer.Stop()
		}
		s.authenticatedMu.Unlock()
		entry.close()
		return nil, nil, false
	}
	release := s.retainAuthenticatedSSHClient(serverID, entry)
	s.authenticatedMu.Unlock()
	return entry.client, release, true
}

// 调用方持锁；释放函数只归还一次引用。
func (s *DesktopSFTPService) retainAuthenticatedSSHClient(serverID string, entry *desktopSFTPAuthenticatedSSHClient) func() {
	entry.users++
	entry.idleGeneration++
	if entry.idleTimer != nil {
		entry.idleTimer.Stop()
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			s.authenticatedMu.Lock()
			defer s.authenticatedMu.Unlock()
			entry.users--
			if s.authenticatedSSH[serverID] == entry && entry.users == 0 {
				s.scheduleAuthenticatedSSHExpiry(serverID, entry)
			}
		})
	}
}

func (s *DesktopSFTPService) clearAuthenticatedSSHClient(serverID string) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return
	}

	s.authenticatedMu.Lock()
	s.authenticatedVersion++
	entry := s.authenticatedSSH[serverID]
	delete(s.authenticatedSSH, serverID)
	if entry != nil && entry.idleTimer != nil {
		entry.idleTimer.Stop()
	}
	s.authenticatedMu.Unlock()

	if entry != nil && entry.client != nil {
		entry.close()
	}
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
	server, err := s.serverService.getByIDStored(serverID)
	if err != nil {
		s.clearAuthenticatedSSHClient(serverID)
		return nil, nil, err
	}
	if client, release, ok := s.acquireAuthenticatedSSHClient(serverID, server.connectionRevision); ok {
		return client, release, nil
	}

	s.authenticatedMu.Lock()
	version := s.authenticatedVersion
	s.authenticatedMu.Unlock()
	client, closeClient, err := s.openSSHClientWithCredentialContext(ctx, serverID, nil)
	if err != nil {
		return nil, nil, err
	}
	current, err := s.serverService.getByIDStored(serverID)
	if err != nil || current.connectionRevision != server.connectionRevision {
		closeClient()
		return nil, nil, errors.New("server connection configuration changed; reconnect")
	}
	s.operationMu.Lock()
	if s.stopping || ctx.Err() != nil {
		s.operationMu.Unlock()
		closeClient()
		return nil, nil, errors.New("file operation stopped")
	}
	s.authenticatedMu.Lock()
	// 凭据变更/主动断开期间建立的连接不能写回连接缓存。
	if version != s.authenticatedVersion {
		s.authenticatedMu.Unlock()
		s.operationMu.Unlock()
		closeClient()
		return nil, nil, errors.New("file connection was invalidated during authentication; reconnect")
	}
	entry := s.authenticatedSSH[serverID]
	if entry == nil {
		entry = &desktopSFTPAuthenticatedSSHClient{client: client, close: closeClient, authenticatedAt: time.Now(), revision: current.connectionRevision}
		s.authenticatedSSH[serverID] = entry
		s.operationWG.Add(1)
		go func() { defer s.operationWG.Done(); s.watchAuthenticatedSSHClient(serverID, entry) }()
	}
	release := s.retainAuthenticatedSSHClient(serverID, entry)
	s.authenticatedMu.Unlock()
	s.operationMu.Unlock()
	if entry.client != client {
		closeClient()
	}
	return entry.client, release, nil
}

func (s *DesktopSFTPService) openClientContext(ctx context.Context, serverID string) (*sftp.Client, func(), error) {
	sshClient, release, err := s.openSSHClientContext(ctx, serverID)
	if err != nil {
		return nil, nil, err
	}
	client, err := desktopSFTPNewClient(ctx, sshClient)
	if err != nil {
		release()
		return nil, nil, err
	}
	return client, desktopSFTPContextCloser(ctx, func() { _ = client.Close(); release() }), nil
}

func (s *DesktopSFTPService) openClientForTransfer(ctx context.Context, serverID string, credential *DesktopSSHCredential) (*sftp.Client, func(), error) {
	if credential == nil {
		return s.openClientContext(ctx, serverID)
	}

	client, closer, err := s.openClientWithCredentialContext(ctx, serverID, credential)
	if err != nil {
		return nil, nil, err
	}

	s.clearAuthenticatedSSHClient(serverID)
	return client, closer, nil
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

	if credential == nil {
		credential, _ = s.serverService.getTemporaryCredential(serverID, server.connectionRevision, server.credentialDigest())
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
	if err := configureDesktopHostKeyAlgorithms(config, server.Host, server.Port); err != nil {
		return nil, nil, err
	}

	client, closeClient, err := s.dialFileSSH(ctx, server, config, 12*time.Second)
	if err != nil {
		return nil, nil, err
	}
	current, err := s.serverService.getByIDRaw(serverID)
	if err != nil || current.connectionRevision != server.connectionRevision || current.credentialDigest() != server.credentialDigest() {
		closeClient()
		return nil, nil, errors.New("server connection configuration changed; reconnect")
	}
	if credential != nil {
		s.serverService.setTemporaryCredential(serverID, server.connectionRevision, server.credentialDigest(), *credential)
	}
	return client, closeClient, nil
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
	sshCloser = desktopSFTPContextCloser(ctx, sshCloser)
	sftpClient, err := desktopSFTPNewClient(ctx, sshClient)
	if err != nil {
		sshCloser()
		return nil, nil, err
	}

	closer := func() {
		_ = sftpClient.Close()
		sshCloser()
	}
	return sftpClient, desktopSFTPContextCloser(ctx, closer), nil
}

func desktopNonNilContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

func desktopSFTPContextCloser(ctx context.Context, closer func()) func() {
	var once sync.Once
	closeOnce := func() error { once.Do(closer); return nil }
	stop := sftputil.CloseOnCancel(desktopNonNilContext(ctx), closeOnce)
	return func() { _ = closeOnce(); stop() }
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

type desktopSFTPTransferStats struct {
	FilesCopied int
	BytesCopied int64
}

type desktopSFTPProgressCallback func(copied int64) error
type desktopSFTPCancelCheck func() bool

func copyDesktopSFTPPlan(ctx context.Context, sourceClient, targetClient *sftp.Client, plan desktopTransferPlan, targetPath string, isCancelled desktopSFTPCancelCheck, onProgress desktopSFTPProgressCallback, onCommit func(desktopSFTPTransferStats) error) (desktopSFTPTransferStats, error) {
	var stats desktopSFTPTransferStats
	if len(plan.entries) == 0 {
		return stats, errors.New("empty relay selection")
	}
	root := plan.entries[0].name
	for _, entry := range plan.entries {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		if isCancelled != nil && isCancelled() {
			return stats, errDesktopSFTPTaskCancelled
		}
		relative := ""
		if entry.name != root {
			if !strings.HasPrefix(entry.name, root+"/") {
				return stats, errors.New("relay requires a single root")
			}
			relative = strings.TrimPrefix(entry.name, root+"/")
		}
		destination := path.Join(targetPath, relative)
		if entry.info.IsDir() {
			if err := targetClient.Mkdir(destination); err != nil {
				return stats, desktopSFTPMutationError(err)
			}
			continue
		}
		if err := copyDesktopSFTPFile(ctx, sourceClient, targetClient, entry.remote, destination, entry.info, &stats, isCancelled, onProgress, onCommit); err != nil {
			return stats, err
		}
	}
	return stats, nil
}

func copyDesktopSFTPFile(
	ctx context.Context,
	sourceClient *sftp.Client,
	targetClient *sftp.Client,
	sourcePath string,
	targetPath string,
	sourceInfo os.FileInfo,
	stats *desktopSFTPTransferStats,
	isCancelled desktopSFTPCancelCheck,
	onProgress desktopSFTPProgressCallback,
	onCommit func(desktopSFTPTransferStats) error,
) error {
	if isCancelled != nil && isCancelled() {
		return errDesktopSFTPTaskCancelled
	}
	remoteFile, err := sourceClient.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer remoteFile.Close()

	var copied int64
	_, err = writeDesktopSFTPCommit(ctx, targetClient, targetPath, sourceInfo.Mode().Perm(), false, func(targetFile *sftp.File) error {
		writer := newDesktopSFTPProgressWriter(targetFile, sourceInfo.Size(), func(loaded int64, _ int64) error {
			if isCancelled != nil && isCancelled() {
				return errDesktopSFTPTaskCancelled
			}
			if onProgress != nil {
				return onProgress(stats.BytesCopied + loaded)
			}
			return nil
		})
		var copyErr error
		copied, copyErr = copyDesktopSFTPExact(writer, remoteFile, sourceInfo)
		return copyErr
	})
	if err != nil {
		return err
	}

	stats.FilesCopied++
	stats.BytesCopied += copied
	if onCommit != nil {
		return onCommit(*stats)
	}
	return nil
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

func firstNonEmptyDesktopSFTP(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
