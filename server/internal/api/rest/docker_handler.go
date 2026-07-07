package rest

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/domain/monitor"
	"github.com/easyssh/server/internal/domain/server"
	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/server/internal/pkg/crypto"
	"github.com/easyssh/shared/dockerutil"
	"github.com/easyssh/shared/textencoding"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/ssh"
)

type DockerContainer = dockerutil.Container
type DockerPort = dockerutil.Port
type DockerMount = dockerutil.Mount
type ContainerStats = dockerutil.ContainerStats
type DockerImage = dockerutil.Image
type DockerSystemInfo = dockerutil.SystemInfo

const dockerResourceStatsLimit = dockerutil.DefaultResourceStatsLimit

// DockerHandler Docker 处理器
type DockerHandler struct {
	serverService   server.Service
	serverRepo      server.Repository
	encryptor       *crypto.Encryptor
	hostKeyCallback ssh.HostKeyCallback
	connectionPool  *monitor.ConnectionPool // SSH 连接池（复用监控连接池）
}

// NewDockerHandler 创建 Docker 处理器
func NewDockerHandler(
	serverService server.Service,
	serverRepo server.Repository,
	encryptor *crypto.Encryptor,
	hostKeyCallback ssh.HostKeyCallback,
	connectionPool *monitor.ConnectionPool,
) *DockerHandler {
	return &DockerHandler{
		serverService:   serverService,
		serverRepo:      serverRepo,
		encryptor:       encryptor,
		hostKeyCallback: hostKeyCallback,
		connectionPool:  connectionPool,
	}
}

// getPooledConnection 从连接池获取 SSH 连接
func (h *DockerHandler) getPooledConnection(c *gin.Context, serverID string) (*monitor.PooledConnection, error) {
	userID, exists := c.Get("user_id")
	if !exists {
		return nil, fmt.Errorf("unauthorized")
	}

	// 使用连接池获取或创建连接
	pooledConn, err := h.connectionPool.GetOrCreate(userID.(string), serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get ssh connection: %w", err)
	}

	return pooledConn, nil
}

// releaseConnection 释放连接（减少引用计数）
func (h *DockerHandler) releaseConnection(c *gin.Context, serverID string) {
	userID, exists := c.Get("user_id")
	if !exists {
		return
	}
	h.connectionPool.Release(userID.(string), serverID)
}

// executeCommand 执行 SSH 命令
func (h *DockerHandler) executeCommand(client *sshDomain.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	if err != nil {
		return string(output), err
	}

	return string(output), nil
}

// ListContainers 获取容器列表
func (h *DockerHandler) ListContainers(c *gin.Context) {
	serverID := c.Param("serverId")
	all := c.DefaultQuery("all", "true") == "true"

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	containers, err := h.listContainersFast(pooledConn.Client, all)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, map[string]interface{}{
		"data":  containers,
		"total": len(containers),
	})
}

const dockerSockNoCurlSentinel = "__EASYSSH_NO_CURL__"

func (h *DockerHandler) listContainersFast(client *sshDomain.Client, all bool) ([]DockerContainer, error) {
	containers, ok, err := h.listContainersViaDockerSock(client, all)
	if err != nil {
		return nil, err
	}
	if ok {
		return containers, nil
	}
	return h.listContainersViaInspect(client, all)
}

func (h *DockerHandler) listContainersViaDockerSock(client *sshDomain.Client, all bool) ([]DockerContainer, bool, error) {
	allFlag := 0
	if all {
		allFlag = 1
	}

	cmd := fmt.Sprintf(
		`sh -lc 'if command -v curl >/dev/null 2>&1; then curl -sS --fail --max-time 5 --unix-socket /var/run/docker.sock "http://localhost/containers/json?all=%d"; else echo "%s"; fi'`,
		allFlag,
		dockerSockNoCurlSentinel,
	)

	output, err := h.executeCommand(client, cmd)
	if err != nil {
		// curl 不可用/失败时回退到 inspect 路径
		return nil, false, nil
	}

	output = strings.TrimSpace(output)
	if output == dockerSockNoCurlSentinel {
		return nil, false, nil
	}

	containers, err := dockerutil.ParseContainersFromSock(output)
	if err != nil {
		return nil, true, err
	}
	return containers, true, nil
}

func (h *DockerHandler) listContainersViaInspect(client *sshDomain.Client, all bool) ([]DockerContainer, error) {
	psFlag := ""
	if all {
		psFlag = "-a"
	}

	metaCmd := fmt.Sprintf(`docker ps %s --no-trunc --format '{{.ID}}\t{{.Status}}\t{{.State}}\t{{.Names}}'`, psFlag)
	metaOut, err := h.executeCommand(client, metaCmd)
	if err != nil {
		return nil, err
	}
	meta := dockerutil.ParsePSMeta(metaOut)

	idsCmd := fmt.Sprintf("docker ps %s -q", psFlag)
	idsOut, err := h.executeCommand(client, idsCmd)
	if err != nil {
		return nil, err
	}

	ids := dockerutil.SplitNonEmptyLines(idsOut)
	if len(ids) == 0 {
		return []DockerContainer{}, nil
	}

	quotedIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		if !dockerutil.ValidateContainerRef(id) {
			return nil, fmt.Errorf("invalid docker container reference from docker ps: %s", id)
		}
		quotedIDs = append(quotedIDs, dockerutil.ShellQuote(id))
	}

	inspectCmd := fmt.Sprintf("docker inspect %s", strings.Join(quotedIDs, " "))
	inspectOut, err := h.executeCommand(client, inspectCmd)
	if err != nil {
		return nil, err
	}

	return dockerutil.ParseInspectContainers(inspectOut, meta)
}

// GetContainerLogs 获取容器日志
func (h *DockerHandler) GetContainerLogs(c *gin.Context) {
	serverID := c.Param("serverId")
	containerID := strings.TrimSpace(c.Param("id"))
	if !dockerutil.ValidateContainerRef(containerID) {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return
	}
	tail, err := dockerutil.ParseTail(c.DefaultQuery("tail", "100"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_tail", err.Error())
		return
	}
	encodingName := c.DefaultQuery("encoding", "utf-8")

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := fmt.Sprintf("docker logs --tail %d %s 2>&1", tail, dockerutil.ShellQuote(containerID))
	output, err := h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		// Docker logs 可能返回错误码但仍有输出
		if output == "" {
			RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
			return
		}
	}
	output = textencoding.Decode(output, encodingName)

	RespondSuccess(c, map[string]interface{}{
		"data":         output,
		"container_id": containerID,
		"lines":        tail,
		"encoding":     encodingName,
	})
}

// StartContainer 启动容器
func (h *DockerHandler) StartContainer(c *gin.Context) {
	serverID := c.Param("serverId")
	containerID := strings.TrimSpace(c.Param("id"))
	if !dockerutil.ValidateContainerRef(containerID) {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return
	}

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := fmt.Sprintf("docker start %s", dockerutil.ShellQuote(containerID))
	_, err = h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	RespondSuccessWithMessage(c, nil, "Container started")
}

// StopContainer 停止容器
func (h *DockerHandler) StopContainer(c *gin.Context) {
	serverID := c.Param("serverId")
	containerID := strings.TrimSpace(c.Param("id"))
	if !dockerutil.ValidateContainerRef(containerID) {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return
	}

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := fmt.Sprintf("docker stop %s", dockerutil.ShellQuote(containerID))
	_, err = h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	RespondSuccessWithMessage(c, nil, "Container stopped")
}

// RestartContainer 重启容器
func (h *DockerHandler) RestartContainer(c *gin.Context) {
	serverID := c.Param("serverId")
	containerID := strings.TrimSpace(c.Param("id"))
	if !dockerutil.ValidateContainerRef(containerID) {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return
	}

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := fmt.Sprintf("docker restart %s", dockerutil.ShellQuote(containerID))
	_, err = h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	RespondSuccessWithMessage(c, nil, "Container restarted")
}

// PauseContainer 暂停容器
func (h *DockerHandler) PauseContainer(c *gin.Context) {
	serverID := c.Param("serverId")
	containerID := strings.TrimSpace(c.Param("id"))
	if !dockerutil.ValidateContainerRef(containerID) {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return
	}

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := fmt.Sprintf("docker pause %s", dockerutil.ShellQuote(containerID))
	_, err = h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	RespondSuccessWithMessage(c, nil, "Container paused")
}

// UnpauseContainer 恢复容器
func (h *DockerHandler) UnpauseContainer(c *gin.Context) {
	serverID := c.Param("serverId")
	containerID := strings.TrimSpace(c.Param("id"))
	if !dockerutil.ValidateContainerRef(containerID) {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return
	}

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := fmt.Sprintf("docker unpause %s", dockerutil.ShellQuote(containerID))
	_, err = h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	RespondSuccessWithMessage(c, nil, "Container unpaused")
}

// RemoveContainer 删除容器
func (h *DockerHandler) RemoveContainer(c *gin.Context) {
	serverID := c.Param("serverId")
	containerID := strings.TrimSpace(c.Param("id"))
	if !dockerutil.ValidateContainerRef(containerID) {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return
	}
	force := c.DefaultQuery("force", "false") == "true"

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := fmt.Sprintf("docker rm %s", dockerutil.ShellQuote(containerID))
	if force {
		cmd = fmt.Sprintf("docker rm -f %s", dockerutil.ShellQuote(containerID))
	}

	_, err = h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	RespondSuccessWithMessage(c, nil, "Container removed")
}

// ListImages 获取镜像列表
func (h *DockerHandler) ListImages(c *gin.Context) {
	serverID := c.Param("serverId")

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := "docker images --format '{{json .}}'"
	output, err := h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	images := dockerutil.ParseImages(output)
	RespondSuccess(c, map[string]interface{}{
		"data":  images,
		"total": len(images),
	})
}

// GetSystemInfo 获取 Docker 系统信息
func (h *DockerHandler) GetSystemInfo(c *gin.Context) {
	serverID := c.Param("serverId")

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := `docker info --format '{"Containers":{{.Containers}},"ContainersRunning":{{.ContainersRunning}},"ContainersPaused":{{.ContainersPaused}},"ContainersStopped":{{.ContainersStopped}},"Images":{{.Images}},"ServerVersion":"{{.ServerVersion}}","Driver":"{{.Driver}}","MemTotal":{{.MemTotal}},"NCPU":{{.NCPU}}}'`
	output, err := h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	info := dockerutil.ParseSystemInfo(output)
	RespondSuccess(c, map[string]interface{}{
		"data": info,
	})
}

// GetStats 获取所有容器统计
func (h *DockerHandler) GetStats(c *gin.Context) {
	serverID := c.Param("serverId")

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	cmd := "docker stats --no-stream --format '{{json .}}'"
	output, err := h.executeCommand(pooledConn.Client, cmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	stats := dockerutil.ParseStats(output)
	RespondSuccess(c, map[string]interface{}{
		"data": stats,
	})
}

// DockerResourcesResponse 资源页签响应（最小化数据）
type DockerResourcesResponse struct {
	Stats             []ContainerStats  `json:"stats"`
	SystemInfo        *DockerSystemInfo `json:"systemInfo"`
	DockerInstalled   bool              `json:"dockerInstalled"`
	StatsTruncated    bool              `json:"statsTruncated"`
	StatsLimit        int               `json:"statsLimit"`
	RunningStatsTotal int               `json:"runningStatsTotal"`
	Error             string            `json:"error,omitempty"`
}

// GetResources 获取资源页签数据（仅 stats + systemInfo）
func (h *DockerHandler) GetResources(c *gin.Context) {
	serverID := c.Param("serverId")

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	// 检查 Docker 是否安装
	checkOutput, err := h.executeCommand(pooledConn.Client, "which docker 2>/dev/null || command -v docker 2>/dev/null")
	if err != nil || strings.TrimSpace(checkOutput) == "" {
		RespondSuccess(c, DockerResourcesResponse{
			DockerInstalled: false,
			StatsLimit:      dockerResourceStatsLimit,
			Error:           "Docker not installed or not accessible",
		})
		return
	}

	output, err := h.executeCommand(pooledConn.Client, dockerutil.BuildResourcesScript(dockerResourceStatsLimit))
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	// 解析输出
	sections := dockerutil.ParseSections(output)

	response := DockerResourcesResponse{
		DockerInstalled: true,
		Stats:           make([]ContainerStats, 0),
		StatsLimit:      dockerResourceStatsLimit,
	}

	if metaData, ok := sections["STATS_META"]; ok {
		meta := dockerutil.ParseStatsMeta(metaData)
		if meta.StatsLimit > 0 {
			response.StatsLimit = meta.StatsLimit
		}
		response.RunningStatsTotal = meta.RunningTotal
		response.StatsTruncated = meta.RunningTotal > meta.StatsSampled
	}

	// 解析统计
	if statsData, ok := sections["STATS"]; ok {
		response.Stats = dockerutil.ParseStats(statsData)
	}
	if response.RunningStatsTotal == 0 {
		response.RunningStatsTotal = len(response.Stats)
	}

	// 解析系统信息
	if infoData, ok := sections["INFO"]; ok {
		response.SystemInfo = dockerutil.ParseSystemInfo(infoData)
	}

	RespondSuccess(c, response)
}

// ImageUpdateCheckResponse 镜像更新检查响应
type ImageUpdateCheckResponse struct {
	HasUpdate     bool   `json:"hasUpdate"`
	ImageName     string `json:"imageName"`
	ContainerName string `json:"containerName"`
	UpdateCommand string `json:"updateCommand"`
	Error         string `json:"error,omitempty"`
}

// CheckContainerImageUpdate 检查容器镜像是否有更新
func (h *DockerHandler) CheckContainerImageUpdate(c *gin.Context) {
	serverID := c.Param("serverId")
	containerID := strings.TrimSpace(c.Param("id"))
	if !dockerutil.ValidateContainerRef(containerID) {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return
	}

	pooledConn, err := h.getPooledConnection(c, serverID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return
	}
	defer h.releaseConnection(c, serverID)

	// 获取容器信息
	inspectCmd := fmt.Sprintf("docker inspect %s --format '{{.Name}}|{{.Config.Image}}'", dockerutil.ShellQuote(containerID))
	output, err := h.executeCommand(pooledConn.Client, inspectCmd)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", "获取容器信息失败: "+err.Error())
		return
	}

	output = strings.TrimSpace(output)
	parts := strings.SplitN(output, "|", 2)
	if len(parts) != 2 {
		RespondError(c, http.StatusInternalServerError, "docker_error", "解析容器信息失败")
		return
	}

	containerName := strings.TrimPrefix(parts[0], "/")
	imageName := strings.TrimSpace(parts[1])
	if !dockerutil.ValidateImageRef(imageName) {
		RespondError(c, http.StatusInternalServerError, "docker_error", "镜像名称无效")
		return
	}
	quotedImageName := dockerutil.ShellQuote(imageName)

	// 获取本地镜像 digest
	localDigestCmd := fmt.Sprintf("docker image inspect %s --format '{{index .RepoDigests 0}}' 2>/dev/null || echo ''", quotedImageName)
	localDigestOutput, _ := h.executeCommand(pooledConn.Client, localDigestCmd)
	localDigest := strings.TrimSpace(localDigestOutput)

	// 提取 digest 部分 (repo@sha256:xxx -> sha256:xxx)
	if idx := strings.Index(localDigest, "@"); idx != -1 {
		localDigest = localDigest[idx+1:]
	}

	// 获取远程镜像 digest (使用 docker manifest inspect)
	remoteDigestCmd := fmt.Sprintf("docker manifest inspect %s 2>/dev/null | grep -m1 '\"digest\"' | cut -d'\"' -f4 || echo ''", quotedImageName)
	remoteDigestOutput, _ := h.executeCommand(pooledConn.Client, remoteDigestCmd)
	remoteDigest := strings.TrimSpace(remoteDigestOutput)

	// 生成展示命令，实际远端执行命令仍使用 quotedImageName。
	updateCommand := fmt.Sprintf("docker pull %s", imageName)

	// 判断是否有更新
	hasUpdate := false
	errorMsg := ""

	if localDigest == "" && remoteDigest == "" {
		// 无法获取 digest 信息，可能是本地构建的镜像或私有仓库
		errorMsg = "无法检查更新：可能是本地构建的镜像或需要登录私有仓库"
	} else if remoteDigest == "" {
		// 无法获取远程 digest
		errorMsg = "无法获取远程镜像信息，请确保网络连接正常且已登录镜像仓库"
	} else if localDigest == "" {
		// 本地没有 digest，可能需要更新
		hasUpdate = true
	} else if localDigest != remoteDigest {
		// digest 不同，有更新
		hasUpdate = true
	}

	RespondSuccess(c, ImageUpdateCheckResponse{
		HasUpdate:     hasUpdate,
		ImageName:     imageName,
		ContainerName: containerName,
		UpdateCommand: updateCommand,
		Error:         errorMsg,
	})
}
