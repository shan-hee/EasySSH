package aichat

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sftp"
	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/server/internal/pkg/crypto"
	sharedmonitoring "github.com/easyssh/shared/monitoring"
	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

// ToolExecutorService 工具执行服务
type ToolExecutorService struct {
	serverService   server.Service
	sftpPool        *sftp.Pool
	encryptor       *crypto.Encryptor
	hostKeyCallback ssh.HostKeyCallback
}

// NewToolExecutorService 创建工具执行服务
func NewToolExecutorService(
	serverService server.Service,
	sftpPool *sftp.Pool,
	encryptor *crypto.Encryptor,
	hostKeyCallback ssh.HostKeyCallback,
) *ToolExecutorService {
	return &ToolExecutorService{
		serverService:   serverService,
		sftpPool:        sftpPool,
		encryptor:       encryptor,
		hostKeyCallback: hostKeyCallback,
	}
}

// ExecuteTool 执行工具调用
func (s *ToolExecutorService) ExecuteTool(ctx context.Context, userID uuid.UUID, toolCall *ToolCall, permissionMode PermissionMode) (*ToolResult, error) {
	mode := NormalizePermissionMode(string(permissionMode))
	if !IsToolAllowedInMode(mode, toolCall.Name) {
		return nil, &ToolPermissionError{
			Mode:     mode,
			ToolName: toolCall.Name,
		}
	}

	result := &ToolResult{
		ToolCallID: toolCall.ID,
	}

	switch toolCall.Name {
	case "list_servers":
		return s.executeListServers(ctx, userID, toolCall)
	case "get_server_info":
		return s.executeGetServerInfo(ctx, userID, toolCall)
	case "execute_command":
		return s.executeCommand(ctx, userID, toolCall)
	case "list_directory":
		return s.executeListDirectory(ctx, userID, toolCall)
	case "read_file":
		return s.executeReadFile(ctx, userID, toolCall)
	case "write_file":
		return s.executeWriteFile(ctx, userID, toolCall)
	case "create_directory":
		return s.executeCreateDirectory(ctx, userID, toolCall)
	case "delete_file":
		return s.executeDeleteFile(ctx, userID, toolCall)
	case "get_system_info":
		return s.executeGetSystemInfo(ctx, userID, toolCall)
	default:
		result.Content = fmt.Sprintf("未知工具: %s", toolCall.Name)
		result.IsError = true
		return result, nil
	}
}

// executeListServers 列出服务器
func (s *ToolExecutorService) executeListServers(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	servers, _, err := s.serverService.List(ctx, userID, 100, 0)
	if err != nil {
		result.Content = fmt.Sprintf("获取服务器列表失败: %v", err)
		result.IsError = true
		return result, nil
	}

	type serverInfo struct {
		ID            string            `json:"id"`
		Name          string            `json:"name"`
		Host          string            `json:"host"`
		Port          int               `json:"port"`
		Username      string            `json:"username"`
		AuthMethod    server.AuthMethod `json:"auth_method"`
		Status        string            `json:"status"`
		Group         string            `json:"group"`
		Tags          []string          `json:"tags"`
		Description   string            `json:"description"`
		OS            string            `json:"os,omitempty"`
		LastConnected *time.Time        `json:"last_connected,omitempty"`
	}

	serverList := make([]serverInfo, len(servers))
	for i, srv := range servers {
		name := srv.Host
		if srv.Name != "" {
			name = srv.Name
		}
		serverList[i] = serverInfo{
			ID:            srv.ID.String(),
			Name:          name,
			Host:          srv.Host,
			Port:          srv.Port,
			Username:      srv.Username,
			AuthMethod:    srv.AuthMethod,
			Status:        string(srv.Status),
			Group:         srv.Group,
			Tags:          srv.Tags,
			Description:   srv.Description,
			OS:            srv.OS,
			LastConnected: srv.LastConnected,
		}
	}

	result.Content = aiToolJSON(fmt.Sprintf("找到 %d 台服务器", len(servers)), serverList)
	return result, nil
}

// executeGetServerInfo 获取服务器详情
func (s *ToolExecutorService) executeGetServerInfo(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	srv, err := s.serverService.GetByID(ctx, userID, serverID)
	if err != nil {
		result.Content = fmt.Sprintf("获取服务器信息失败: %v", err)
		result.IsError = true
		return result, nil
	}

	info := map[string]interface{}{
		"id":              srv.ID.String(),
		"name":            srv.Name,
		"host":            srv.Host,
		"port":            srv.Port,
		"username":        srv.Username,
		"auth_method":     srv.AuthMethod,
		"status":          srv.Status,
		"group":           srv.Group,
		"tags":            srv.Tags,
		"description":     srv.Description,
		"os":              srv.OS,
		"last_connected":  srv.LastConnected,
		"has_password":    srv.Password != "",
		"has_private_key": srv.PrivateKey != "",
		"country":         srv.Country,
		"city":            srv.City,
	}

	result.Content = aiToolJSON("服务器信息", info)
	return result, nil
}

// executeCommand 执行命令
func (s *ToolExecutorService) executeCommand(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
		Command  string `json:"command"`
		Timeout  int    `json:"timeout"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	if args.Timeout <= 0 {
		args.Timeout = 30
	}
	if args.Timeout > 300 {
		args.Timeout = 300
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	srv, err := s.serverService.GetByID(ctx, userID, serverID)
	if err != nil {
		result.Content = fmt.Sprintf("获取服务器信息失败: %v", err)
		result.IsError = true
		return result, nil
	}

	// 创建 SSH 客户端
	sshClient, err := sshDomain.NewClient(srv, s.encryptor, s.hostKeyCallback)
	if err != nil {
		result.Content = fmt.Sprintf("创建SSH客户端失败: %v", err)
		result.IsError = true
		return result, nil
	}

	connectCtx, connectCancel := context.WithTimeout(ctx, 12*time.Second)
	defer connectCancel()

	if err := sshClient.ConnectContext(connectCtx, srv.Host, srv.Port); err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer sshClient.Close()

	commandCtx, commandCancel := context.WithTimeout(ctx, time.Duration(args.Timeout)*time.Second)
	defer commandCancel()

	commandResult, err := sshClient.ExecuteCommandDetailedContext(commandCtx, args.Command)
	if err != nil && commandResult == nil {
		result.Content = fmt.Sprintf("命令执行失败: %v", err)
		result.IsError = true
		return result, nil
	}

	output := commandResult.Output
	if len([]rune(output)) > 12000 {
		runes := []rune(output)
		output = string(runes[:12000]) + "\n... (输出已截断)"
	}

	payload := map[string]interface{}{
		"server_id":    serverID.String(),
		"command":      commandResult.Command,
		"exit_code":    commandResult.ExitCode,
		"duration_ms":  commandResult.DurationMs,
		"started_at":   commandResult.StartedAt.Format(time.RFC3339Nano),
		"completed_at": commandResult.CompletedAt.Format(time.RFC3339Nano),
		"output":       output,
	}
	if err != nil || commandResult.ExitCode != 0 {
		result.Content = aiToolJSON("命令执行失败", payload)
		result.IsError = true
		return result, nil
	}

	result.Content = aiToolJSON("命令执行成功", payload)
	return result, nil
}

// executeListDirectory 列出目录
func (s *ToolExecutorService) executeListDirectory(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	if args.Path == "" || args.Path == "~" {
		args.Path = "."
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	// 获取 SFTP 客户端
	client, err := s.sftpPool.Get(ctx, userID, serverID)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	// 列出目录
	listing, err := client.ListDirectory(args.Path)
	if err != nil {
		result.Content = fmt.Sprintf("列出目录失败: %v", err)
		result.IsError = true
		return result, nil
	}

	files := make([]map[string]interface{}, 0, len(listing.Files))
	for _, f := range listing.Files {
		files = append(files, map[string]interface{}{
			"name":        f.Name,
			"path":        f.Path,
			"size":        f.Size,
			"is_dir":      f.IsDir,
			"is_link":     f.IsLink,
			"permission":  f.Permission,
			"modified_at": f.ModTime,
			"link_target": f.LinkTarget,
		})
	}

	result.Content = aiToolJSON("目录列表", map[string]interface{}{
		"path":     listing.Path,
		"parent":   sftputil.ParentPath(listing.Path),
		"files":    files,
		"total":    len(files),
		"can_read": listing.CanRead,
	})
	return result, nil
}

// executeReadFile 读取文件
func (s *ToolExecutorService) executeReadFile(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
		MaxLines int    `json:"max_lines"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	if args.MaxLines <= 0 {
		args.MaxLines = 100
	}
	if args.MaxLines > 500 {
		args.MaxLines = 500
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	// 获取 SFTP 客户端
	client, err := s.sftpPool.Get(ctx, userID, serverID)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	info, err := client.GetFileInfo(args.Path)
	if err != nil {
		result.Content = fmt.Sprintf("获取文件信息失败: %v", err)
		result.IsError = true
		return result, nil
	}
	if info.IsDir {
		result.Content = "读取文件失败: cannot read a directory"
		result.IsError = true
		return result, nil
	}
	if info.Size > sftputil.MaxTextFileBytes {
		result.Content = fmt.Sprintf("读取文件失败: file is too large to edit: %d bytes", info.Size)
		result.IsError = true
		return result, nil
	}

	// 读取文件
	content, err := client.ReadFile(args.Path)
	if err != nil {
		result.Content = fmt.Sprintf("读取文件失败: %v", err)
		result.IsError = true
		return result, nil
	}

	// 限制行数
	lines := strings.Split(string(content), "\n")
	truncated := false
	if len(lines) > args.MaxLines {
		lines = lines[:args.MaxLines]
		truncated = true
	}

	output := strings.Join(lines, "\n")
	if truncated {
		output += fmt.Sprintf("\n\n... (文件已截断，仅显示前 %d 行)", args.MaxLines)
	}

	result.Content = fmt.Sprintf("文件内容 (%s):\n```\n%s\n```", args.Path, output)
	return result, nil
}

// executeWriteFile 写入文件
func (s *ToolExecutorService) executeWriteFile(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
		Content  string `json:"content"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	// 获取 SFTP 客户端
	client, err := s.sftpPool.Get(ctx, userID, serverID)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	// 写入文件
	if err := client.WriteFile(args.Path, []byte(args.Content), 0644); err != nil {
		result.Content = fmt.Sprintf("写入文件失败: %v", err)
		result.IsError = true
		return result, nil
	}

	info, err := client.GetFileInfo(args.Path)
	if err != nil {
		result.Content = fmt.Sprintf("获取文件信息失败: %v", err)
		result.IsError = true
		return result, nil
	}

	result.Content = aiToolJSON("文件已写入", info)
	return result, nil
}

// executeCreateDirectory 创建目录
func (s *ToolExecutorService) executeCreateDirectory(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	// 获取 SFTP 客户端
	client, err := s.sftpPool.Get(ctx, userID, serverID)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	// 创建目录（递归）
	if err := client.CreateDirectories(args.Path); err != nil {
		result.Content = fmt.Sprintf("创建目录失败: %v", err)
		result.IsError = true
		return result, nil
	}

	info, err := client.GetFileInfo(args.Path)
	if err != nil {
		result.Content = fmt.Sprintf("获取目录信息失败: %v", err)
		result.IsError = true
		return result, nil
	}

	result.Content = aiToolJSON("目录已创建", info)
	return result, nil
}

// executeDeleteFile 删除文件
func (s *ToolExecutorService) executeDeleteFile(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	// 获取 SFTP 客户端
	client, err := s.sftpPool.Get(ctx, userID, serverID)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	// 获取文件信息
	info, err := client.GetFileInfo(args.Path)
	if err != nil {
		result.Content = fmt.Sprintf("获取文件信息失败: %v", err)
		result.IsError = true
		return result, nil
	}

	// 删除
	if info.IsDir {
		if err := client.DeleteDirectory(args.Path); err != nil {
			result.Content = fmt.Sprintf("删除目录失败: %v", err)
			result.IsError = true
			return result, nil
		}
	} else {
		if err := client.DeleteFile(args.Path); err != nil {
			result.Content = fmt.Sprintf("删除文件失败: %v", err)
			result.IsError = true
			return result, nil
		}
	}

	result.Content = aiToolJSON("文件或目录已删除", info)
	return result, nil
}

// executeGetSystemInfo 获取系统信息
func (s *ToolExecutorService) executeGetSystemInfo(ctx context.Context, userID uuid.UUID, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	srv, err := s.serverService.GetByID(ctx, userID, serverID)
	if err != nil {
		result.Content = fmt.Sprintf("获取服务器信息失败: %v", err)
		result.IsError = true
		return result, nil
	}

	// 创建 SSH 客户端
	sshClient, err := sshDomain.NewClient(srv, s.encryptor, s.hostKeyCallback)
	if err != nil {
		result.Content = fmt.Sprintf("创建SSH客户端失败: %v", err)
		result.IsError = true
		return result, nil
	}

	connectCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	if err := sshClient.ConnectContext(connectCtx, srv.Host, srv.Port); err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer sshClient.Close()

	command := sharedmonitoring.BuildMetricsScript(sharedmonitoring.MetricsScriptOptions{
		IncludeStaticInfo:  true,
		IncludeDockerStats: true,
	})
	commandCtx, commandCancel := context.WithTimeout(ctx, 30*time.Second)
	defer commandCancel()
	commandResult, err := sshClient.ExecuteCommandDetailedContext(commandCtx, command)
	if err != nil && commandResult == nil {
		result.Content = fmt.Sprintf("获取系统信息失败: %v", err)
		result.IsError = true
		return result, nil
	}
	if commandResult.ExitCode != 0 {
		message := strings.TrimSpace(commandResult.Output)
		if message == "" {
			message = fmt.Sprintf("monitor command failed with exit code %d", commandResult.ExitCode)
		}
		result.Content = "获取系统信息失败: " + message
		result.IsError = true
		return result, nil
	}

	metrics := sharedmonitoring.ParseMetricsOutput(commandResult.Output)
	disks := make([]map[string]interface{}, 0, len(metrics.Disks))
	for _, disk := range metrics.Disks {
		disks = append(disks, map[string]interface{}{
			"mountPoint": disk.MountPoint,
			"usedBytes":  disk.UsedBytes,
			"totalBytes": disk.TotalBytes,
		})
	}

	collectedAt := time.Now().UTC()
	result.Content = aiToolJSON("系统信息", map[string]interface{}{
		"system_info": map[string]interface{}{
			"os":            metrics.SystemInfo.OS,
			"hostname":      metrics.SystemInfo.Hostname,
			"cpuModel":      metrics.SystemInfo.CPUModel,
			"arch":          metrics.SystemInfo.Arch,
			"loadAvg":       metrics.SystemInfo.LoadAvg,
			"uptimeSeconds": int64(metrics.SystemInfo.UptimeSeconds),
			"cpuCores":      int(metrics.SystemInfo.CPUCores),
		},
		"cpu": map[string]interface{}{
			"idleTicks":    metrics.CPU.IdleTotal(),
			"totalTicks":   metrics.CPU.Total(),
			"coreCount":    int(metrics.SystemInfo.CPUCores),
			"usagePercent": float64(0),
		},
		"memory": map[string]interface{}{
			"ramUsedBytes":   metrics.Memory.RAMUsedBytes,
			"ramTotalBytes":  metrics.Memory.RAMTotalBytes,
			"swapUsedBytes":  metrics.Memory.SwapUsedBytes,
			"swapTotalBytes": metrics.Memory.SwapTotalBytes,
		},
		"network": map[string]interface{}{
			"bytesRecvTotal": metrics.Network.BytesRecvTotal,
			"bytesSentTotal": metrics.Network.BytesSentTotal,
		},
		"disks": disks,
		"docker": map[string]interface{}{
			"containersRunning": int(metrics.Docker.ContainersRunning),
			"containersTotal":   int(metrics.Docker.ContainersTotal),
			"dockerInstalled":   metrics.Docker.DockerInstalled,
		},
		"ssh_latency_ms": commandResult.DurationMs,
		"collected_at":   collectedAt.Format(time.RFC3339Nano),
	})
	return result, nil
}

func aiToolJSON(title string, value interface{}) string {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return strings.TrimSpace(title) + ":\n" + fmt.Sprint(value)
	}
	return strings.TrimSpace(title) + ":\n" + string(data)
}

// 辅助函数：按行读取并限制行数
func readLines(content string, maxLines int) ([]string, bool) {
	scanner := bufio.NewScanner(strings.NewReader(content))
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) >= maxLines {
			return lines, true
		}
	}
	return lines, false
}
