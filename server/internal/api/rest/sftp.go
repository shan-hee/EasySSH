package rest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/server/internal/domain/grant"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sftp"
	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sftputil"
	"github.com/easyssh/shared/sshutil"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	maxTextReadBytes  = sftputil.MaxTextFileBytes
	maxTextWriteBytes = sftputil.MaxTextFileBytes
)

// SFTPHandler SFTP 处理器
type SFTPHandler struct {
	serverService    server.Service
	encryptor        *crypto.Encryptor
	hostKeyCallback  sshutil.HostKeyPolicy // SSH主机密钥验证回调
	pool             *sftp.Pool            // SFTP 连接池
	credentialStore  *sshDomain.RuntimeCredentialStore
	operationRecords operationrecord.Service
	taskRuns         taskcenter.Service
	contents         *content.Service
	deleteMu         sync.Mutex
	deleteWG         sync.WaitGroup
	deleteStopped    bool
	deleteCancels    map[uuid.UUID]context.CancelFunc
}

// NewSFTPHandler 创建 SFTP 处理器
func NewSFTPHandler(serverService server.Service, serverRepo server.Repository, encryptor *crypto.Encryptor, hostKeyCallback sshutil.HostKeyPolicy, poolConfig *sftp.PoolConfig, credentialStore *sshDomain.RuntimeCredentialStore, operationRecords operationrecord.Service) *SFTPHandler {
	// 创建连接池
	pool := sftp.NewPool(
		poolConfig,
		encryptor,
		hostKeyCallback,
		serverService,
		serverRepo,
		credentialStore,
	)

	return &SFTPHandler{
		serverService:    serverService,
		encryptor:        encryptor,
		hostKeyCallback:  hostKeyCallback,
		pool:             pool,
		credentialStore:  credentialStore,
		operationRecords: operationRecords,
	}
}

func (h *SFTPHandler) SetContentStore(service *content.Service) { h.contents = service }

func (h *SFTPHandler) SetTaskCenter(service taskcenter.Service) {
	h.taskRuns = service
}

// GetPool 获取连接池（用于外部访问）
func (h *SFTPHandler) GetPool() *sftp.Pool {
	return h.pool
}

// Close 关闭 SFTP 处理器（关闭连接池）
func (h *SFTPHandler) Close() {
	h.stopDeletes()
	if h.pool != nil {
		h.pool.CloseAll()
	}
}

func isSFTPCredentialRequiredError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sshDomain.ErrCredentialRequired) {
		return true
	}

	message := strings.ToLower(err.Error())
	return strings.Contains(message, "keyboard_interactive_required") ||
		strings.Contains(message, "server credential is required") ||
		strings.Contains(message, "unable to authenticate") ||
		strings.Contains(message, "permission denied") ||
		strings.Contains(message, "authentication failed") ||
		strings.Contains(message, "no supported methods remain") ||
		strings.Contains(message, "failed to decrypt password") ||
		strings.Contains(message, "failed to decrypt private key") ||
		strings.Contains(message, "failed to parse private key")
}

func isSFTPPrivateKeyPassphraseError(err error) (string, bool) {
	if err == nil {
		return "", false
	}

	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "private_key_passphrase_required"):
		return "sftp_private_key_passphrase_required", true
	case strings.Contains(message, "private_key_passphrase_invalid"):
		return "sftp_private_key_passphrase_invalid", true
	default:
		return "", false
	}
}

func classifySFTPHostKeyError(err error) (string, int, bool) {
	if err == nil {
		return "", 0, false
	}

	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "host key trust has been revoked"):
		return "host_key_revoked", http.StatusForbidden, true
	case strings.Contains(message, "host key verification failed") ||
		strings.Contains(message, "ssh host key verification failed"):
		return "sftp_host_key_changed", http.StatusPreconditionRequired, true
	default:
		return "", 0, false
	}
}

func respondSFTPAccessError(c *gin.Context, err error) bool {
	if errors.Is(err, grant.ErrQuota) || errors.Is(err, access.ErrForbidden) || errors.Is(err, access.ErrRevoked) || errors.Is(err, access.ErrExpired) || errors.Is(err, access.ErrResourceChanged) || errors.Is(err, access.ErrUnauthenticated) {
		accessError(c, err)
		return true
	}
	return false
}
func respondSFTPConnectionError(c *gin.Context, err error) {
	if respondSFTPAccessError(c, err) {
		return
	}
	if code, status, ok := classifySFTPHostKeyError(err); ok {
		RespondError(c, status, code, err.Error())
		return
	}
	if code, ok := isSFTPPrivateKeyPassphraseError(err); ok {
		RespondError(c, http.StatusPreconditionRequired, code, err.Error())
		return
	}
	if isSFTPCredentialRequiredError(err) {
		RespondError(c, http.StatusPreconditionRequired, "sftp_credential_required", err.Error())
		return
	}

	RespondError(c, http.StatusInternalServerError, "sftp_error", err.Error())
}

// Authenticate 使用临时凭据为指定服务器建立 SFTP 池化连接。
// POST /api/v1/sftp/:server_id/auth
func (h *SFTPHandler) Authenticate(c *gin.Context) {
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var req protocol.SFTPAuthenticateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}
	if !server.AuthMethod(req.AuthMethod).IsValid() {
		RespondError(c, http.StatusBadRequest, "unsupported_auth_method", "Unsupported authentication method")
		return
	}

	client, err := h.pool.GetWithCredential(c.Request.Context(), serverID, protocol.FilesList, sftp.Credential{
		AuthMethod:           server.AuthMethod(req.AuthMethod),
		Secret:               req.Secret,
		Password:             req.Password,
		PrivateKey:           req.PrivateKey,
		PrivateKeyPassphrase: req.PrivateKeyPassphrase,
	})
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer client.Release()

	RespondSuccess(c, protocol.SFTPAuthenticateResult{Success: true})
}

// getPooledClient 从连接池获取 SFTP 客户端
// 调用者需要在操作完成后调用 client.Release() 释放连接
func (h *SFTPHandler) getPooledClient(c *gin.Context, serverID uuid.UUID) (*sftp.PooledClient, error) {
	return h.pool.Get(c.Request.Context(), serverID, access.Operation(c.Request.Context()).Action)
}

// ListDirectory 列出目录
// GET /api/v1/sftp/:server_id/list?path=/path/to/dir
func (h *SFTPHandler) ListDirectory(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 获取路径参数
	path := c.DefaultQuery("path", "/")

	acquireStarted := time.Now()
	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release() // 释放回连接池，而不是关闭

	acquireDuration := time.Since(acquireStarted)
	readStarted := time.Now()
	listing, err := sftpClient.ListDirectoryContext(c.Request.Context(), path)
	c.Header("Server-Timing", fmt.Sprintf("sftp_acquire;dur=%.2f, sftp_read;dur=%.2f",
		float64(acquireDuration.Microseconds())/1000, float64(time.Since(readStarted).Microseconds())/1000))
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled):
			return
		case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF), !sftpClient.IsHealthy():
			RespondError(c, http.StatusBadGateway, "sftp_connection_error", err.Error())
		case errors.Is(err, os.ErrNotExist):
			RespondError(c, http.StatusNotFound, "directory_not_found", err.Error())
		case errors.Is(err, os.ErrPermission):
			RespondError(c, http.StatusForbidden, "directory_permission_denied", err.Error())
		default:
			RespondError(c, http.StatusInternalServerError, "list_failed", err.Error())
		}
		return
	}

	RespondSuccess(c, listing)
}

// GetFileInfo 获取文件信息
// GET /api/v1/sftp/:server_id/stat?path=/path/to/file
func (h *SFTPHandler) GetFileInfo(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 获取路径参数
	path := c.Query("path")
	if path == "" {
		RespondError(c, http.StatusBadRequest, "missing_path", "Path parameter is required")
		return
	}

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	// 获取文件信息
	fileInfo, err := sftpClient.GetFileInfo(path)
	if err != nil {
		RespondError(c, http.StatusNotFound, "file_not_found", err.Error())
		return
	}

	RespondSuccess(c, fileInfo)
}

// CreateDirectory 创建目录
// POST /api/v1/sftp/:server_id/mkdir
func (h *SFTPHandler) CreateDirectory(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 解析请求
	var req protocol.SFTPCreateDirectoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	run, ok := h.beginFileMutation(c, serverID, "sftp_mkdir", req.Path, 1, req)
	if !ok {
		return
	}
	// 创建目录
	if req.Recursive {
		err = sftpClient.CreateDirectories(req.Path)
	} else {
		err = sftpClient.CreateDirectory(req.Path)
	}

	if !h.finishSingleFileMutation(c, *run, err) {
		return
	}

	// 返回新建目录的 FileInfo,用于前端差异更新
	fileInfo, err := sftpClient.GetFileInfo(req.Path)
	if err != nil {
		RespondError(c, http.StatusConflict, "file_metadata_unavailable", "Operation completed; refresh file metadata or inspect the task record")
		return
	}

	RespondSuccess(c, fileInfo)
}

// Delete 删除文件或目录
// DELETE /api/v1/sftp/:server_id/delete
func (h *SFTPHandler) Delete(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 解析请求
	var req protocol.SFTPPathRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}
	if containsDotDotSegment(req.Path) {
		RespondError(c, http.StatusBadRequest, "invalid_path", "Path must not contain '..'")
		return
	}

	// 记录删除操作开始
	startTime := time.Now()
	fmt.Printf("[SFTP Delete] Starting delete operation: server=%s, path=%s\n", serverID, req.Path)

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		fmt.Printf("[SFTP Delete] Failed to get SFTP client: %v\n", err)
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	// 获取文件信息以判断类型,同时用于删除成功后的差异更新响应
	fileInfo, err := sftpClient.GetFileInfo(req.Path)
	if err != nil {
		fmt.Printf("[SFTP Delete] File not found: %s, error: %v\n", req.Path, err)
		RespondError(c, http.StatusNotFound, "file_not_found", err.Error())
		return
	}

	// 目录必须走 DeletePaths，由后端决定快速完成还是创建递归任务。
	if fileInfo.IsDir {
		RespondError(c, http.StatusConflict, "directory_delete_requires_delete_paths", "Directory deletion must use the optimized delete-paths endpoint")
		return
	}
	run, ok := h.beginFileMutation(c, serverID, "sftp_delete_file", req.Path, 1, req)
	if !ok {
		return
	}
	fmt.Printf("[SFTP Delete] Deleting file: %s\n", req.Path)
	err = sftpClient.DeleteFile(req.Path)

	if !h.finishSingleFileMutation(c, *run, err) {
		return
	}

	elapsed := time.Since(startTime)
	fmt.Printf("[SFTP Delete] Delete completed successfully in %v: %s\n", elapsed, req.Path)

	// 返回被删除文件的信息，便于前端做差异更新。
	RespondSuccessWithMessage(c, fileInfo, "Deleted")
}

// DeletePaths creates one SFTP task. Unknown effects are never replayed via shell.
func (h *SFTPHandler) DeletePaths(c *gin.Context) {
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, sftputil.MaxDeleteRequestBytes)
	var req protocol.SFTPDeletePathsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}
	paths := make([]string, 0, len(req.Paths))
	seenPaths := make(map[string]struct{}, len(req.Paths))
	for _, remotePath := range req.Paths {
		normalized, err := validateBackgroundDeletePath(remotePath)
		if err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_path", err.Error())
			return
		}
		if _, exists := seenPaths[normalized]; exists {
			continue
		}
		seenPaths[normalized] = struct{}{}
		paths = append(paths, normalized)
	}
	if h.taskRuns == nil {
		RespondError(c, http.StatusServiceUnavailable, "task_center_unavailable", "Task center is unavailable")
		return
	}
	runID := uuid.New()
	work, done, err := h.beginDelete(c.Request.Context(), runID)
	if err != nil {
		RespondError(c, http.StatusServiceUnavailable, "delete_unavailable", err.Error())
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{"server_id": serverID, "paths": paths})
	run := &taskcenter.TaskRun{
		ID: runID, SourceType: "sftp_delete", SourceID: runID.String(), ServerID: &serverID, TaskType: "sftp_recursive_delete", Title: fmt.Sprintf("递归删除 %d 个远端项目", len(paths)),
		TriggerType: taskcenter.TriggerManual, Runner: "server", Status: taskcenter.StatusQueued,
		Resource: strings.Join(paths, ", "), PayloadJSON: string(payload), ResultJSON: fmt.Sprintf(`{"items_content_id":%q}`, runID.String()), TotalCount: len(paths), Cancelable: true, Retryable: false,
	}
	if err := h.taskRuns.Create(c.Request.Context(), run); err != nil {
		done()
		RespondError(c, http.StatusInternalServerError, "create_delete_task_failed", err.Error())
		return
	}
	go func() {
		defer done()
		h.executeRecursiveDeleteTask(work, *run, serverID, paths)
	}()
	c.JSON(http.StatusAccepted, protocol.SFTPDeletePathsResult{Mode: "recursive_task", DeletedPaths: []string{}, TaskID: run.ID.String()})
}

func validateBackgroundDeletePath(remotePath string) (string, error) {
	return sftputil.ValidateDeletePath(remotePath)
}

// Rename 重命名文件或目录
// POST /api/v1/sftp/:server_id/rename
func (h *SFTPHandler) Rename(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 解析请求
	var req protocol.SFTPRenameRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	run, ok := h.beginFileMutation(c, serverID, "sftp_rename", req.NewPath, 1, req)
	if !ok {
		return
	}
	// 重命名
	if !h.finishSingleFileMutation(c, *run, sftpClient.RenameFile(req.OldPath, req.NewPath)) {
		return
	}

	// 返回重命名后的文件信息,用于前端差异更新
	fileInfo, err := sftpClient.GetFileInfo(req.NewPath)
	if err != nil {
		RespondError(c, http.StatusConflict, "file_metadata_unavailable", "Operation completed; refresh file metadata or inspect the task record")
		return
	}

	RespondSuccess(c, fileInfo)
}

// Chmod 修改文件或目录权限
// POST /api/v1/sftp/:server_id/chmod
func (h *SFTPHandler) Chmod(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 解析请求
	var req protocol.SFTPChmodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	// 解析权限模式（八进制字符串转为 os.FileMode）
	mode, err := sftputil.ParsePermissionMode(req.Mode)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_mode", "Invalid permission mode format")
		return
	}

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	run, ok := h.beginFileMutation(c, serverID, "sftp_chmod", req.Path, 1, req)
	if !ok {
		return
	}
	// 修改权限
	if !h.finishSingleFileMutation(c, *run, sftpClient.Chmod(req.Path, mode)) {
		return
	}

	RespondSuccess(c, protocol.ChmodResponse{Path: req.Path, Mode: req.Mode})
}

// ReadFile 读取文件内容
// GET /api/v1/sftp/:server_id/read?path=/path/to/file
func (h *SFTPHandler) ReadFile(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 获取路径参数
	path := c.Query("path")
	if path == "" {
		RespondError(c, http.StatusBadRequest, "missing_path", "Path parameter is required")
		return
	}

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	// 读取前先做 size 限制与类型校验，避免 io.ReadAll 造成内存压力
	fi, err := sftpClient.GetFileInfo(path)
	if err != nil {
		RespondError(c, http.StatusNotFound, "file_not_found", err.Error())
		return
	}
	if fi.IsDir {
		RespondError(c, http.StatusBadRequest, "not_a_file", "Path is a directory")
		return
	}
	if fi.Size > maxTextReadBytes {
		RespondError(c, http.StatusRequestEntityTooLarge, "file_too_large", fmt.Sprintf("File exceeds max size (%d bytes)", maxTextReadBytes))
		return
	}

	// 读取文件
	content, err := sftpClient.ReadFile(path)
	if err != nil {
		if !respondSFTPAccessError(c, err) {
			RespondError(c, http.StatusInternalServerError, "read_failed", err.Error())
		}
		return
	}

	c.Data(http.StatusOK, "text/plain", content)
}

// WriteFile 写入文件内容
// POST /api/v1/sftp/:server_id/write
func (h *SFTPHandler) WriteFile(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 解析 JSON 请求体
	var req protocol.SFTPWriteRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(maxTextWriteBytes*6+8192))
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}
	if len(*req.Content) > maxTextWriteBytes {
		RespondError(c, http.StatusRequestEntityTooLarge, "content_too_large", fmt.Sprintf("Content exceeds max size (%d bytes)", maxTextWriteBytes))
		return
	}

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	run, ok := h.beginFileMutation(c, serverID, "sftp_write", req.Path, 1, map[string]any{"path": req.Path, "content_bytes": len(*req.Content)})
	if !ok {
		return
	}
	// 写入文件
	if !h.finishSingleFileMutation(c, *run, sftpClient.WriteFile(req.Path, []byte(*req.Content), 0644)) {
		return
	}

	// 返回最新的文件信息,便于前端更新大小/修改时间等
	fileInfo, err := sftpClient.GetFileInfo(req.Path)
	if err != nil {
		RespondError(c, http.StatusConflict, "file_metadata_unavailable", "Operation completed; refresh file metadata or inspect the task record")
		return
	}

	RespondSuccessWithMessage(c, fileInfo, "File written successfully")
}

// GetDiskUsage 获取磁盘使用情况
// GET /api/v1/sftp/:server_id/disk-usage?path=/
func (h *SFTPHandler) GetDiskUsage(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 获取路径参数
	path := c.DefaultQuery("path", "/")

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	// 获取磁盘使用情况
	diskUsage, err := sftpClient.GetDiskUsage(path)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "disk_usage_failed", err.Error())
		return
	}

	RespondSuccess(c, diskUsage)
}

// BatchOperationError 批量操作错误信息
type BatchOperationError = protocol.BatchOperationError

// BatchDeleteResponse 批量删除响应
type BatchDeleteResponse = protocol.BatchDeleteResponse

// BatchDelete 批量删除文件或目录
// DELETE /api/v1/sftp/:server_id/batch-delete
func (h *SFTPHandler) BatchDelete(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID")
		return
	}

	// 解析请求
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, sftputil.MaxDeleteRequestBytes)
	var req protocol.SFTPBatchDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	// 记录批量删除操作开始
	startTime := time.Now()
	fmt.Printf("[SFTP BatchDelete] Starting batch delete operation: server=%s, count=%d\n", serverID, len(req.Paths))

	// 从连接池获取 SFTP 客户端
	sftpClient, err := h.getPooledClient(c, serverID)
	if err != nil {
		fmt.Printf("[SFTP BatchDelete] Failed to get SFTP client: %v\n", err)
		respondSFTPConnectionError(c, err)
		return
	}
	defer sftpClient.Release()

	// 批量删除
	success := []string{}
	failed := []BatchOperationError{}
	run, ok := h.beginFileMutation(c, serverID, "sftp_batch_delete", strings.Join(req.Paths, ", "), len(req.Paths), req)
	if !ok {
		return
	}
	attempted := 0
	var interrupted map[string]string
	finish := func(operationErr error) bool {
		return h.finishFileMutation(c, *run, map[string]any{"success": success, "failed": failed, "total": len(req.Paths), "unprocessed": req.Paths[attempted:], "interrupted": interrupted}, operationErr, len(success), len(failed))
	}
	for index, path := range req.Paths {
		select {
		case <-c.Request.Context().Done():
			finish(c.Request.Context().Err())
			return
		default:
		}
		attempted = index + 1
		if containsDotDotSegment(path) {
			failed = append(failed, BatchOperationError{
				Path:    path,
				Error:   "invalid_path",
				Message: "Path must not contain '..'",
			})
			continue
		}

		// 获取文件信息以判断类型
		fileInfo, err := sftpClient.GetFileInfo(path)
		if c.Request.Context().Err() != nil {
			attempted = index // No deletion was attempted for this path.
			finish(c.Request.Context().Err())
			return
		}
		if err != nil {
			fmt.Printf("[SFTP BatchDelete] File not found: %s, error: %v\n", path, err)
			failed = append(failed, BatchOperationError{
				Path:    path,
				Error:   "file_not_found",
				Message: err.Error(),
			})
			continue
		}

		// 同步批量接口只处理普通文件；目录统一交给优化删除入口。
		if fileInfo.IsDir {
			failed = append(failed, BatchOperationError{
				Path: path, Error: "directory_delete_requires_delete_paths",
				Message: "Directory deletion must use the optimized delete-paths endpoint",
			})
			continue
		}
		fmt.Printf("[SFTP BatchDelete] Deleting file: %s\n", path)
		deleteErr := sftpClient.DeleteFile(path)

		if errors.Is(deleteErr, sftputil.ErrMutationOutcomeUnknown) {
			interrupted = map[string]string{"path": path, "error": "file_outcome_unknown"}
			finish(deleteErr)
			return
		}
		if errors.Is(deleteErr, context.Canceled) || errors.Is(deleteErr, context.DeadlineExceeded) {
			attempted = index
			finish(deleteErr)
			return
		}
		if deleteErr != nil {
			fmt.Printf("[SFTP BatchDelete] Delete failed: %s, error: %v\n", path, deleteErr)
			failed = append(failed, BatchOperationError{
				Path:    path,
				Error:   "delete_failed",
				Message: deleteErr.Error(),
			})
		} else {
			success = append(success, path)
			// Save confirmed effects before attempting the next file. Recovery retains
			// this progress even if the process cannot write the final outcome.
			progress, _ := json.Marshal(map[string]any{"success": success, "failed": failed, "unprocessed": req.Paths[attempted:]})
			if saveErr := h.taskRuns.UpdateProgress(c.Request.Context(), run.ID, (index+1)*100/len(req.Paths), "sftp_batch_delete", string(progress), len(success), len(failed)); saveErr != nil {
				finish(saveErr)
				return
			}
		}
	}

	elapsed := time.Since(startTime)
	fmt.Printf("[SFTP BatchDelete] Batch delete completed in %v: success=%d, failed=%d\n", elapsed, len(success), len(failed))

	if !finish(nil) {
		return
	}
	RespondSuccess(c, BatchDeleteResponse{
		Success: success,
		Failed:  failed,
		Total:   len(req.Paths),
	})
}

// ======================================
// 连接池管理 API
// ======================================

// GetPoolStats 获取连接池统计信息
// GET /api/v1/sftp/pool/stats
func (h *SFTPHandler) GetPoolStats(c *gin.Context) {
	stats := h.pool.Stats()
	RespondSuccess(c, stats)
}

func containsDotDotSegment(p string) bool {
	for _, part := range strings.Split(p, "/") {
		if part == ".." {
			return true
		}
	}
	return false
}
