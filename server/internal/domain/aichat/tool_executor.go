package aichat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"slices"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sftp"
	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/shared/aitooloutput"
	"github.com/easyssh/shared/aiworkspace"
	sharedmonitoring "github.com/easyssh/shared/monitoring"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sftputil"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
)

// ToolExecutorService 工具执行服务
type ToolExecutorService struct {
	serverService   server.Service
	sftpPool        *sftp.Pool
	encryptor       *crypto.Encryptor
	hostKeyCallback sshutil.HostKeyPolicy
}

// NewToolExecutorService 创建工具执行服务
func NewToolExecutorService(
	serverService server.Service,
	sftpPool *sftp.Pool,
	encryptor *crypto.Encryptor,
	hostKeyCallback sshutil.HostKeyPolicy,
) *ToolExecutorService {
	return &ToolExecutorService{
		serverService:   serverService,
		sftpPool:        sftpPool,
		encryptor:       encryptor,
		hostKeyCallback: hostKeyCallback,
	}
}

var toolActions = map[string][]protocol.Action{
	"get_server_info":  {protocol.WorkspaceRead},
	"execute_command":  {protocol.TerminalConnect},
	"list_directory":   {protocol.FilesList},
	"read_file":        {protocol.FilesRead},
	"write_file":       {protocol.FilesWrite, protocol.FilesRead},
	"create_directory": {protocol.FilesWrite},
	"delete_file":      {protocol.FilesDelete},
	"get_system_info":  {protocol.MonitorRead},
}

// ToolActions lists the permissions a server tool needs on its target server.
// list_servers has none: it only returns servers the scope can already read.
func ToolActions(name string) []protocol.Action { return toolActions[name] }

// ExecuteTool 执行工具调用
func (s *ToolExecutorService) ExecuteTool(ctx context.Context, toolCall *ToolCall, permissionMode PermissionMode) (*ToolResult, error) {
	return s.executeAuthorizedTool(ctx, toolCall, permissionMode, true)
}

// ExecuteOperation exposes the same resource operations to machine clients.
// Authority still comes from Scope; callers cannot choose an AI permission mode.
func (s *ToolExecutorService) ExecuteOperation(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
	if toolCall.Name == "execute_command" {
		return nil, access.ErrForbidden
	} // durable task queue only
	return s.executeAuthorizedTool(ctx, toolCall, PermissionModePrivileged, false)
}

func (s *ToolExecutorService) executeAuthorizedTool(ctx context.Context, toolCall *ToolCall, permissionMode PermissionMode, requireAI bool) (*ToolResult, error) {
	scope := access.Current(ctx)
	requirements := []access.Requirement{{Action: protocol.WorkspaceRead}}
	if toolCall.Name != "list_servers" {
		var target struct {
			ServerID string `json:"server_id"`
		}
		if err := json.Unmarshal(toolCall.Arguments, &target); err != nil {
			return nil, err
		}
		if _, err := uuid.Parse(target.ServerID); err != nil {
			return nil, access.ErrForbidden
		}
		actions := ToolActions(toolCall.Name)
		if len(actions) == 0 {
			return nil, access.ErrForbidden
		}
		requirements = make([]access.Requirement, 0, len(actions)+1)
		for _, action := range actions {
			requirements = append(requirements, access.Requirement{Action: action, ServerID: target.ServerID})
		}
		if requireAI {
			requirements = append(requirements, access.Requirement{Action: protocol.AIUse, ServerID: target.ServerID})
		}
	}
	lease, err := scope.OpenWork(ctx, access.Task, requirements...)
	if err != nil {
		return nil, err
	}
	defer lease.Close(nil)
	ctx = lease.Context()
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
		return s.listServers(ctx, toolCall, requireAI)
	case "get_server_info":
		return s.executeGetServerInfo(ctx, toolCall)
	case "execute_command":
		return s.executeCommand(ctx, toolCall)
	case "list_directory":
		return s.executeListDirectory(ctx, toolCall)
	case "read_file":
		return s.executeReadFile(ctx, toolCall)
	case "write_file":
		if !requireAI {
			prepared, err := s.prepareWriteFileFor(ctx, toolCall.Arguments, false)
			if err != nil {
				return nil, err
			}
			ctx = aiworkspace.WithFile(ctx, prepared)
		}
		return s.executeWriteFile(ctx, toolCall)
	case "create_directory":
		return s.executeCreateDirectory(ctx, toolCall)
	case "delete_file":
		return s.executeDeleteFile(ctx, toolCall)
	case "get_system_info":
		return s.executeGetSystemInfo(ctx, toolCall)
	default:
		result.Content = fmt.Sprintf("未知工具: %s", toolCall.Name)
		result.IsError = true
		return result, nil
	}
}

// executeListServers 列出服务器
func (s *ToolExecutorService) executeListServers(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
	return s.listServers(ctx, toolCall, true)
}

func (s *ToolExecutorService) listServers(ctx context.Context, toolCall *ToolCall, requireAI bool) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	servers, _, err := s.serverService.List(ctx, access.Current(ctx), 100, 0)
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

	serverList := make([]serverInfo, 0, len(servers))
	for _, srv := range servers {
		if requireAI && access.Current(ctx).Check(ctx, access.Requirement{Action: protocol.AIUse, ServerID: srv.ID.String()}) != nil {
			continue
		}
		name := srv.Host
		if srv.Name != "" {
			name = srv.Name
		}
		serverList = append(serverList, serverInfo{
			ID:            srv.ID.String(),
			Name:          name,
			Host:          srv.Host,
			Port:          srv.Port,
			Username:      srv.Username,
			AuthMethod:    srv.Auth.AuthMethod,
			Status:        string(srv.Status),
			Group:         srv.Group,
			Tags:          srv.Tags,
			Description:   srv.Description,
			OS:            srv.OS,
			LastConnected: srv.LastConnected,
		})
	}

	result.Content = aiToolJSON(fmt.Sprintf("找到 %d 台服务器", len(serverList)), serverList)
	return result, nil
}

// executeGetServerInfo 获取服务器详情
func (s *ToolExecutorService) executeGetServerInfo(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
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

	srv, err := s.serverService.GetByID(ctx, access.Current(ctx), serverID)
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
		"auth_method":     srv.Auth.AuthMethod,
		"status":          srv.Status,
		"group":           srv.Group,
		"tags":            srv.Tags,
		"description":     srv.Description,
		"os":              srv.OS,
		"last_connected":  srv.LastConnected,
		"has_password":    srv.Auth.Password != "",
		"has_private_key": srv.Auth.SSHKeyID != nil,
		"country":         srv.Country,
		"city":            srv.City,
	}

	result.Content = aiToolJSON("服务器信息", info)
	return result, nil
}

// executeCommand 执行命令
func (s *ToolExecutorService) executeCommand(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
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
		args.Timeout = 60
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

	srv, err := s.serverService.GetByID(ctx, access.Current(ctx), serverID)
	if err != nil {
		result.Content = fmt.Sprintf("获取服务器信息失败: %v", err)
		result.IsError = true
		return result, nil
	}

	// 创建 SSH 客户端
	sshClient, err := sshDomain.NewClient(ctx, srv, s.encryptor, s.hostKeyCallback)
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
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			result.Cancelled, result.Content = true, "命令未开始，已取消。"
			return result, nil
		}
		result.Content = fmt.Sprintf("命令执行失败: %v", err)
		result.IsError = true
		return result, nil
	}

	output := aitooloutput.Truncate(aitooloutput.Sanitize(commandResult.Output), aitooloutput.StoredTextBytes)
	result.CommandOutput = output

	payload := map[string]interface{}{
		"server_id":    serverID.String(),
		"command":      commandResult.Command,
		"exit_code":    commandResult.ExitCode,
		"outcome":      commandResult.Outcome,
		"error":        commandResult.Error,
		"duration_ms":  commandResult.DurationMs,
		"started_at":   commandResult.StartedAt.Format(time.RFC3339Nano),
		"completed_at": commandResult.CompletedAt.Format(time.RFC3339Nano),
		"output":       output,
	}
	if commandResult.Outcome == "unknown" {
		result.Content = aiToolJSON("命令结果未知，先只读核对，不能直接重试", payload)
		result.Unknown = true
		return result, nil
	}
	if commandResult.Outcome == "canceled" {
		title := "命令已取消，远端进程已终止；此前产生的效果不会回滚"
		if errors.Is(err, context.DeadlineExceeded) {
			title = fmt.Sprintf("命令超过 %d 秒已终止；此前产生的效果不会回滚", args.Timeout)
		}
		result.Content = aiToolJSON(title, payload)
		result.Cancelled = true
		return result, nil
	}
	if commandResult.Outcome != "succeeded" {
		result.Content = aiToolJSON("命令执行失败", payload)
		result.IsError = true
		return result, nil
	}

	result.Content = aiToolJSON("命令执行成功", payload)
	return result, nil
}

// executeListDirectory 列出目录
func (s *ToolExecutorService) executeListDirectory(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
		Offset   int    `json:"offset"`
		Limit    int    `json:"limit"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	if args.Path == "" || args.Path == "~" {
		args.Path = "."
	}
	args.Offset = max(args.Offset, 0)
	if args.Limit <= 0 {
		args.Limit = 100
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	// 获取 SFTP 客户端
	client, err := s.sftpPool.Get(ctx, serverID, protocol.FilesList)
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

	// SFTP returns entries in server order; pages need a stable order.
	slices.SortFunc(listing.Files, func(a, b *sftp.FileInfo) int { return strings.Compare(a.Name, b.Name) })
	start := min(args.Offset, len(listing.Files))
	end, size := start, 0
	files := make([]map[string]interface{}, 0, min(args.Limit, len(listing.Files)-start))
	// Stop at whole entries within the same output budget as read_file.
	for ; end < len(listing.Files) && end-start < args.Limit; end++ {
		f := listing.Files[end]
		entry := map[string]interface{}{
			"name":        f.Name,
			"path":        f.Path,
			"size":        f.Size,
			"is_dir":      f.IsDir,
			"is_link":     f.IsLink,
			"permission":  f.Permission,
			"modified_at": f.ModTime,
			"link_target": f.LinkTarget,
		}
		// Measured as aiToolJSON renders it, two levels deep: the first line's
		// indent and the trailing ",\n" are added separately.
		rendered, _ := json.MarshalIndent(entry, "    ", "  ")
		size += len(rendered) + 6
		if size > aitooloutput.StoredTextBytes && end > start {
			break
		}
		files = append(files, entry)
	}

	page := map[string]interface{}{
		"path":     listing.Path,
		"parent":   sftputil.ParentPath(listing.Path),
		"files":    files,
		"offset":   start,
		"total":    len(listing.Files),
		"can_read": listing.CanRead,
	}
	if end < len(listing.Files) {
		page["next_offset"] = end
	}
	result.Content = aiToolJSON("目录列表", page)
	return result, nil
}

// executeReadFile 读取文件
func (s *ToolExecutorService) executeReadFile(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
	result := &ToolResult{ToolCallID: toolCall.ID}

	var args struct {
		ServerID  string `json:"server_id"`
		Path      string `json:"path"`
		StartLine int    `json:"start_line"`
		MaxLines  int    `json:"max_lines"`
	}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Content = fmt.Sprintf("参数解析失败: %v", err)
		result.IsError = true
		return result, nil
	}

	args.StartLine = max(args.StartLine, 1)
	// No upper bound: the output byte budget below is the hard limit.
	if args.MaxLines <= 0 {
		args.MaxLines = 100
	}

	serverID, err := uuid.Parse(args.ServerID)
	if err != nil {
		result.Content = fmt.Sprintf("无效的服务器ID: %v", err)
		result.IsError = true
		return result, nil
	}

	// 获取 SFTP 客户端
	client, err := s.sftpPool.Get(ctx, serverID, protocol.FilesRead)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	content, exists, err := readPreviewFile(client.Client, args.Path)
	if err != nil || !exists {
		result.Content = "读取文件失败: file does not exist"
		if err != nil {
			result.Content = fmt.Sprintf("读取文件失败: %v", err)
		}
		result.IsError = true
		return result, nil
	}

	// Store the complete bounded snapshot separately from the model's excerpt.
	if file, fileErr := aiworkspace.NewFile(args.Path, string(content), "utf8"); fileErr == nil {
		file.Kind, file.Path, file.ServerID = "read", args.Path, args.ServerID
		result.Artifact = file
	}
	// The hash covers the raw file, so it matches write_file's expected_sha256 check.
	hash := aiworkspace.Hash(content)
	lines := strings.Split(strings.TrimSuffix(aitooloutput.Sanitize(content), "\n"), "\n")
	if args.StartLine > len(lines) {
		result.Content = fmt.Sprintf("文件 %s 共 %d 行，start_line=%d 超出范围 (sha256=%s)", args.Path, len(lines), args.StartLine, hash)
		result.IsError = true
		return result, nil
	}
	// Stop at whole lines within the output budget so the reported range is exact.
	end := args.StartLine - 1
	for size := 0; end < len(lines) && end-args.StartLine+1 < args.MaxLines; end++ {
		lineBytes := len(lines[end])
		if end > args.StartLine-1 {
			lineBytes++ // separator between returned lines
		}
		if size+lineBytes > aitooloutput.StoredTextBytes {
			if end == args.StartLine-1 {
				result.Content = fmt.Sprintf("文件 %s 第 %d 行超过 %d 字节的单次输出限制，无法按整行返回；请使用有权限的命令按字节范围读取 (sha256=%s)", args.Path, args.StartLine, aitooloutput.StoredTextBytes, hash)
				result.IsError = true
				return result, nil
			}
			break
		}
		size += lineBytes
	}
	output := strings.Join(lines[args.StartLine-1:end], "\n")
	next := ""
	if end < len(lines) {
		next = fmt.Sprintf("，继续读取请传 start_line=%d", end+1)
	}

	result.Content = fmt.Sprintf("文件内容 (%s，第 %d-%d 行，共 %d 行，sha256=%s%s):\n```\n%s\n```", args.Path, args.StartLine, end, len(lines), hash, next, output)
	return result, nil
}

// executeWriteFile 写入文件
func (s *ToolExecutorService) executeWriteFile(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
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
	client, err := s.sftpPool.Get(ctx, serverID, protocol.FilesWrite)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	prepared := aiworkspace.PreparedFile(ctx)
	before, exists, readErr := readPreviewFile(client.Client, args.Path)
	if readErr != nil {
		return nil, readErr
	}
	if err := prepared.CheckBaseline(before, exists); err != nil {
		return nil, err
	}
	if prepared.Content != args.Content || prepared.Path != args.Path || prepared.ServerID != args.ServerID {
		return nil, fmt.Errorf("prepared file does not match this operation")
	}

	// 写入文件
	if err := client.WriteFile(args.Path, []byte(args.Content), 0644); err != nil {
		result.Content = fmt.Sprintf("写入文件未完成: %v", err)
		result.Unknown = errors.Is(err, sftputil.ErrMutationOutcomeUnknown)
		result.IsError = !result.Unknown
		if result.Unknown {
			result.Content = "写入结果未知，先只读核对，不能直接重试：" + err.Error()
		}
		return result, nil
	}

	info, err := client.GetFileInfo(args.Path)
	if err != nil {
		result.Content = fmt.Sprintf("文件已写入，后续读取属性未完成；不能据此重复写入：%v", err)
		result.Artifact = prepared
		return result, nil
	}

	actual, existsAfter, verifyErr := readPreviewFile(client.Client, args.Path)
	if verifyErr != nil {
		result.Artifact = prepared
		result.Content = "文件已写入，后续核对未完成；先重新读取，不能直接重复写入：" + verifyErr.Error()
		return result, nil
	}
	if !existsAfter || actual != args.Content {
		result.Artifact = prepared
		result.Content = "写入请求已成功，但后续读取内容不一致；请重新读取核对，不自动重复写入。"
		return result, nil
	}
	result.Artifact = prepared

	result.Content = aiToolJSON("文件已写入", info)
	return result, nil
}

// executeCreateDirectory 创建目录
func (s *ToolExecutorService) executeCreateDirectory(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
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
	client, err := s.sftpPool.Get(ctx, serverID, protocol.FilesWrite)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	// 创建目录（递归）。失败前可能已有父目录创建，不能直接重试。
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := client.CreateDirectories(args.Path); err != nil {
		result.Content = fmt.Sprintf("多级目录创建未完成，可能已有目录创建；先只读核对：%v", err)
		result.Unknown = true
		return result, nil
	}

	info, err := client.GetFileInfo(args.Path)
	if err != nil {
		result.Content = fmt.Sprintf("目录已创建，后续读取属性未完成；不能据此重复创建：%v", err)
		return result, nil
	}

	result.Content = aiToolJSON("目录已创建", info)
	return result, nil
}

// executeDeleteFile 删除文件
func (s *ToolExecutorService) executeDeleteFile(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
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
	client, err := s.sftpPool.Get(ctx, serverID, protocol.FilesDelete)
	if err != nil {
		result.Content = fmt.Sprintf("连接服务器失败: %v", err)
		result.IsError = true
		return result, nil
	}
	defer client.Release()

	var report sftputil.DeleteReport
	err = client.DeleteTree(args.Path, &report, nil)
	result.Unknown = errors.Is(err, sftputil.ErrMutationOutcomeUnknown)
	result.IsError = err != nil && !result.Unknown
	message := "文件或目录已删除"
	if err != nil {
		message = "删除未完成：" + err.Error()
		if result.Unknown {
			message = "删除回执丢失，先只读核对，不能直接重试：" + err.Error()
		}
	}
	result.Content = aiToolJSON(message, report)
	return result, nil
}

// executeGetSystemInfo 获取系统信息
func (s *ToolExecutorService) executeGetSystemInfo(ctx context.Context, toolCall *ToolCall) (*ToolResult, error) {
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

	srv, err := s.serverService.GetByID(ctx, access.Current(ctx), serverID)
	if err != nil {
		result.Content = fmt.Sprintf("获取服务器信息失败: %v", err)
		result.IsError = true
		return result, nil
	}

	// 创建 SSH 客户端
	sshClient, err := sshDomain.NewClient(ctx, srv, s.encryptor, s.hostKeyCallback)
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
		IncludeDockerStats: access.Current(ctx).Check(ctx, access.Requirement{Action: protocol.DockerRead, ServerID: serverID.String()}) == nil,
	})
	commandCtx, commandCancel := context.WithTimeout(ctx, 30*time.Second)
	defer commandCancel()
	commandResult, err := sshClient.ExecuteCommandDetailedContext(commandCtx, command)
	if err != nil && commandResult == nil {
		result.Content = fmt.Sprintf("获取系统信息失败: %v", err)
		result.IsError = true
		return result, nil
	}
	if commandResult.Outcome != "succeeded" {
		message := strings.TrimSpace(commandResult.Output)
		if message == "" {
			message = "monitor command " + commandResult.Outcome + ": " + commandResult.Error
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
