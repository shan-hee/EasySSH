package rest

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"net/http"

	"github.com/easyssh/server/internal/access"

	"github.com/easyssh/server/internal/domain/docker"
	"github.com/easyssh/shared/dockerutil"
	"github.com/easyssh/shared/textencoding"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type DockerContainer = dockerutil.Container
type DockerPort = dockerutil.Port
type DockerMount = dockerutil.Mount
type ContainerStats = dockerutil.ContainerStats
type DockerImage = dockerutil.Image
type DockerSystemInfo = dockerutil.SystemInfo

const dockerResourceStatsLimit = dockerutil.DefaultResourceStatsLimit

type DockerHandler struct{ service *docker.Service }

func NewDockerHandler(service *docker.Service) *DockerHandler {
	return &DockerHandler{service: service}
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
	RespondSuccess(c, dockerutil.ContainersResult{Data: containers, Total: len(containers)})
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

	RespondSuccess(c, dockerutil.LogsResult{Data: textencoding.Decode(string(output), encodingName), ContainerID: containerID, Lines: tail, Encoding: encodingName})
}

func (h *DockerHandler) StartContainer(c *gin.Context) {
	h.containerAction(c, protocol.DockerActionStart, false)
}

func (h *DockerHandler) StopContainer(c *gin.Context) {
	h.containerAction(c, protocol.DockerActionStop, false)
}

func (h *DockerHandler) RestartContainer(c *gin.Context) {
	h.containerAction(c, protocol.DockerActionRestart, false)
}

func (h *DockerHandler) PauseContainer(c *gin.Context) {
	h.containerAction(c, protocol.DockerActionPause, false)
}

func (h *DockerHandler) UnpauseContainer(c *gin.Context) {
	h.containerAction(c, protocol.DockerActionUnpause, false)
}

func (h *DockerHandler) RemoveContainer(c *gin.Context) {
	h.containerAction(c, protocol.DockerActionRemove, c.DefaultQuery("force", "false") == "true")
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
	RespondSuccess(c, dockerutil.ImagesResult{Data: images, Total: len(images)})
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
	RespondSuccess(c, protocol.DockerSystemResult{Data: info})
}

func (h *DockerHandler) GetStats(c *gin.Context) {
	dockerClient, cleanup, ok := h.clientForRequest(c)
	if !ok {
		return
	}
	defer cleanup()
	stats, total, err := dockerClient.Stats(c.Request.Context(), dockerutil.MaxStatsLimit)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "docker_error", err.Error())
		return
	}
	RespondSuccess(c, dockerutil.StatsResult{Data: stats, Total: total, Limit: dockerutil.MaxStatsLimit, Truncated: total > dockerutil.MaxStatsLimit})
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

type DockerResourcesResponse = dockerutil.ResourcesResult

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

type ImageUpdateCheckResponse = dockerutil.ImageUpdateResult

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
	dockerClient, ctx, cleanup, err := h.service.Client(c.Request.Context(), c.Param("serverId"))
	if err != nil {
		respondDockerError(c, err)
		return nil, nil, false
	}

	c.Request = c.Request.WithContext(ctx)
	return dockerClient, cleanup, true
}

func (h *DockerHandler) containerAction(c *gin.Context, action protocol.DockerAction, force bool) {
	containerID, ok := normalizeDockerContainerID(c)
	if !ok {
		return
	}
	result, err := h.service.Apply(c.Request.Context(), c.Param("serverId"), containerID, action, force)
	if err != nil {
		respondDockerError(c, err)
		return
	}
	respondDockerResult(c, result)
}

func respondDockerResult(c *gin.Context, result protocol.DockerActionResult) {
	// An accepted operation returns its actual outcome, including unknown. Clients
	// must not treat an HTTP transport error as permission to repeat the mutation.
	RespondSuccess(c, result)
}

func (h *DockerHandler) Result(c *gin.Context) {
	id, err := uuid.Parse(c.Param("taskId"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_task_id", "Invalid task ID")
		return
	}
	result, err := h.service.Result(c.Request.Context(), c.Param("serverId"), id)
	if err != nil {
		respondDockerError(c, err)
		return
	}
	respondDockerResult(c, result)
}

func normalizeDockerContainerID(c *gin.Context) (string, bool) {
	containerID, err := dockerutil.NormalizeContainerRef(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_docker_reference", "Invalid container ID or name")
		return "", false
	}
	return containerID, true
}

func respondDockerError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, resultstore.ErrUnavailable):
		RespondError(c, http.StatusServiceUnavailable, "storage_unavailable", "Execution result could not be stored")
	case errors.Is(err, access.ErrUnauthenticated), errors.Is(err, access.ErrForbidden), errors.Is(err, access.ErrExpired), errors.Is(err, access.ErrRevoked), errors.Is(err, access.ErrResourceChanged), errors.Is(err, access.ErrCapacity):
		accessError(c, err)
	case errors.Is(err, gorm.ErrRecordNotFound):
		RespondError(c, http.StatusNotFound, "task_not_found", "Docker task not found")
	case errors.Is(err, docker.ErrInvalidOperation):
		RespondError(c, http.StatusBadRequest, "invalid_docker_operation", err.Error())
	case errors.Is(err, docker.ErrStopped):
		RespondError(c, http.StatusServiceUnavailable, "docker_stopped", err.Error())
	default:
		RespondError(c, http.StatusBadGateway, "docker_error", err.Error())
	}
}
