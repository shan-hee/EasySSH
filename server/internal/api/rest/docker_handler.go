package rest

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/domain/monitor"
	"github.com/easyssh/shared/dockerutil"
	"github.com/easyssh/shared/textencoding"
	"github.com/gin-gonic/gin"
)

type DockerContainer = dockerutil.Container
type DockerPort = dockerutil.Port
type DockerMount = dockerutil.Mount
type ContainerStats = dockerutil.ContainerStats
type DockerImage = dockerutil.Image
type DockerSystemInfo = dockerutil.SystemInfo

const dockerResourceStatsLimit = dockerutil.DefaultResourceStatsLimit
const dockerSocketPath = "/var/run/docker.sock"

type DockerHandler struct {
	connectionPool *monitor.ConnectionPool
}

func NewDockerHandler(connectionPool *monitor.ConnectionPool) *DockerHandler {
	return &DockerHandler{connectionPool: connectionPool}
}

func (h *DockerHandler) getDockerClient(c *gin.Context, serverID string) (*dockerutil.Client, func(), error) {
	userID, exists := c.Get("user_id")
	if !exists {
		return nil, nil, fmt.Errorf("unauthorized")
	}
	userIDValue, ok := userID.(string)
	if !ok || strings.TrimSpace(userIDValue) == "" {
		return nil, nil, fmt.Errorf("invalid user identity")
	}

	pooledConnection, err := h.connectionPool.GetOrCreate(userIDValue, serverID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get ssh connection: %w", err)
	}
	cleanupPool := func() { h.connectionPool.Release(userIDValue, serverID) }

	rawConnection := pooledConnection.Client.GetRawConnection()
	if rawConnection == nil {
		cleanupPool()
		return nil, nil, fmt.Errorf("ssh connection is not available")
	}
	dockerClient, err := dockerutil.NewClient(rawConnection.DialContext, dockerSocketPath)
	if err != nil {
		cleanupPool()
		return nil, nil, err
	}
	cleanup := func() {
		_ = dockerClient.Close()
		cleanupPool()
	}
	return dockerClient, cleanup, nil
}

func (h *DockerHandler) ListContainers(c *gin.Context) {
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()

	containers, err := dockerClient.ListContainers(c.Request.Context(), c.DefaultQuery("all", "true") == "true")
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, map[string]interface{}{"data": containers, "total": len(containers)})
}

func (h *DockerHandler) GetContainerLogs(c *gin.Context) {
	containerID, ok := normalizeDockerContainerID(c)
	if !ok {
		return
	}
	tail, err := dockerutil.ParseTail(c.DefaultQuery("tail", "100"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_tail", err.Error())
		return
	}
	encodingName := c.DefaultQuery("encoding", "utf-8")

	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	output, err := dockerClient.Logs(c.Request.Context(), containerID, tail)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}

	RespondSuccess(c, map[string]interface{}{
		"data":         textencoding.Decode(string(output), encodingName),
		"container_id": containerID,
		"lines":        tail,
		"encoding":     encodingName,
	})
}

func (h *DockerHandler) StartContainer(c *gin.Context) {
	h.containerAction(c, "Container started", (*dockerutil.Client).Start)
}

func (h *DockerHandler) StopContainer(c *gin.Context) {
	h.containerAction(c, "Container stopped", (*dockerutil.Client).Stop)
}

func (h *DockerHandler) RestartContainer(c *gin.Context) {
	h.containerAction(c, "Container restarted", (*dockerutil.Client).Restart)
}

func (h *DockerHandler) PauseContainer(c *gin.Context) {
	h.containerAction(c, "Container paused", (*dockerutil.Client).Pause)
}

func (h *DockerHandler) UnpauseContainer(c *gin.Context) {
	h.containerAction(c, "Container unpaused", (*dockerutil.Client).Unpause)
}

func (h *DockerHandler) RemoveContainer(c *gin.Context) {
	containerID, ok := normalizeDockerContainerID(c)
	if !ok {
		return
	}
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	if err := dockerClient.Remove(c.Request.Context(), containerID, c.DefaultQuery("force", "false") == "true"); err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccessWithMessage(c, nil, "Container removed")
}

func (h *DockerHandler) ListImages(c *gin.Context) {
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	images, err := dockerClient.ListImages(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, map[string]interface{}{"data": images, "total": len(images)})
}

func (h *DockerHandler) GetSystemInfo(c *gin.Context) {
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	info, err := dockerClient.SystemInfo(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, map[string]interface{}{"data": info})
}

func (h *DockerHandler) GetStats(c *gin.Context) {
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	stats, _, err := dockerClient.Stats(c.Request.Context(), -1)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, map[string]interface{}{"data": stats})
}

func (h *DockerHandler) GetContainerStat(c *gin.Context) {
	containerID, ok := normalizeDockerContainerID(c)
	if !ok {
		return
	}
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	stats, err := dockerClient.ContainerStat(c.Request.Context(), containerID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, stats)
}

type DockerResourcesResponse struct {
	Stats             []ContainerStats  `json:"stats"`
	SystemInfo        *DockerSystemInfo `json:"systemInfo"`
	DockerInstalled   bool              `json:"dockerInstalled"`
	StatsTruncated    bool              `json:"statsTruncated"`
	StatsLimit        int               `json:"statsLimit"`
	RunningStatsTotal int               `json:"runningStatsTotal"`
	Error             string            `json:"error,omitempty"`
}

func (h *DockerHandler) GetResources(c *gin.Context) {
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	ctx := c.Request.Context()
	if err := dockerClient.Ping(ctx); err != nil {
		RespondSuccess(c, DockerResourcesResponse{
			Stats:           []ContainerStats{},
			DockerInstalled: false,
			StatsLimit:      dockerResourceStatsLimit,
			Error:           "Docker not installed or not accessible",
		})
		return
	}

	info, err := dockerClient.SystemInfo(ctx)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	stats, runningTotal, err := dockerClient.Stats(ctx, dockerResourceStatsLimit)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, DockerResourcesResponse{
		Stats:             stats,
		SystemInfo:        info,
		DockerInstalled:   true,
		StatsTruncated:    runningTotal > len(stats),
		StatsLimit:        dockerResourceStatsLimit,
		RunningStatsTotal: runningTotal,
	})
}

type ImageUpdateCheckResponse struct {
	HasUpdate     bool   `json:"hasUpdate"`
	ImageName     string `json:"imageName"`
	ContainerName string `json:"containerName"`
	UpdateCommand string `json:"updateCommand"`
	Error         string `json:"error,omitempty"`
}

func (h *DockerHandler) CheckContainerImageUpdate(c *gin.Context) {
	containerID, ok := normalizeDockerContainerID(c)
	if !ok {
		return
	}
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	update, err := dockerClient.CheckImageUpdate(c.Request.Context(), containerID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, ImageUpdateCheckResponse{
		HasUpdate:     update.HasUpdate,
		ImageName:     update.ImageName,
		ContainerName: update.ContainerName,
		UpdateCommand: update.UpdateCommand,
		Error:         update.Error,
	})
}

func (h *DockerHandler) clientForRequest(c *gin.Context) (*dockerutil.Client, func(), bool) {
	dockerClient, cleanup, err := h.getDockerClient(c, c.Param("serverId"))
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ssh_error", err.Error())
		return nil, nil, false
	}
	return dockerClient, cleanup, true
}

func (h *DockerHandler) containerAction(c *gin.Context, message string, action func(*dockerutil.Client, context.Context, string) error) {
	containerID, ok := normalizeDockerContainerID(c)
	if !ok {
		return
	}
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	if err := action(dockerClient, c.Request.Context(), containerID); err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccessWithMessage(c, nil, message)
}

func normalizeDockerContainerID(c *gin.Context) (string, bool) {
	containerID, err := dockerutil.NormalizeContainerRef(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return "", false
	}
	return containerID, true
}
