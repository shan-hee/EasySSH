package app

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"strings"
	"time"

	"github.com/easyssh/shared/dockerutil"
	"github.com/easyssh/shared/sftputil"
	"github.com/easyssh/shared/textencoding"
)

const desktopDockerResourceStatsLimit = dockerutil.DefaultResourceStatsLimit
const desktopDockerSocketPath = "/var/run/docker.sock"

type DesktopDockerServerInput struct {
	ServerID string `json:"serverId"`
}

type DesktopDockerListContainersInput struct {
	ServerID string `json:"serverId"`
	All      bool   `json:"all,omitempty"`
}

type DesktopDockerContainerInput struct {
	ServerID    string `json:"serverId"`
	ContainerID string `json:"containerId"`
}

type DesktopDockerContainerLogsInput struct {
	ServerID    string `json:"serverId"`
	ContainerID string `json:"containerId"`
	Tail        int    `json:"tail,omitempty"`
	Encoding    string `json:"encoding,omitempty"`
}

type DesktopDockerRemoveContainerInput struct {
	ServerID    string `json:"serverId"`
	ContainerID string `json:"containerId"`
	Force       bool   `json:"force,omitempty"`
}

type DesktopDockerContainer = dockerutil.Container
type DesktopDockerPort = dockerutil.Port
type DesktopDockerMount = dockerutil.Mount
type DesktopDockerContainerStats = dockerutil.ContainerStats
type DesktopDockerImage = dockerutil.Image
type DesktopDockerSystemInfo = dockerutil.SystemInfo

type DesktopDockerContainersResult = dockerutil.ContainersResult
type DesktopDockerImagesResult = dockerutil.ImagesResult
type DesktopDockerContainerLogsResult = dockerutil.LogsResult
type DesktopDockerResourcesResult = dockerutil.ResourcesResult
type DesktopDockerImageUpdateCheckResult = dockerutil.ImageUpdateResult

type DesktopDockerService struct {
	desktopOperationRegistry
	serverService *DesktopServerService
	tasks         *DesktopTaskService
}

func NewDesktopDockerService(serverService *DesktopServerService, tasks *DesktopTaskService) *DesktopDockerService {
	return &DesktopDockerService{serverService: serverService, tasks: tasks}
}

func (s *DesktopDockerService) ListContainers(input DesktopDockerListContainersInput) (DesktopDockerContainersResult, error) {
	ctx, client, cleanup, err := s.client(input.ServerID, 30*time.Second)
	if err != nil {
		return DesktopDockerContainersResult{}, err
	}
	defer cleanup()
	containers, err := client.ListContainers(ctx, input.All)
	if err != nil {
		return DesktopDockerContainersResult{}, err
	}
	return DesktopDockerContainersResult{Data: containers, Total: len(containers)}, nil
}

func (s *DesktopDockerService) ListImages(input DesktopDockerServerInput) (DesktopDockerImagesResult, error) {
	ctx, client, cleanup, err := s.client(input.ServerID, 30*time.Second)
	if err != nil {
		return DesktopDockerImagesResult{}, err
	}
	defer cleanup()
	images, err := client.ListImages(ctx)
	if err != nil {
		return DesktopDockerImagesResult{}, err
	}
	return DesktopDockerImagesResult{Data: images, Total: len(images)}, nil
}

func (s *DesktopDockerService) GetResources(input DesktopDockerServerInput) (DesktopDockerResourcesResult, error) {
	ctx, client, cleanup, err := s.client(input.ServerID, 45*time.Second)
	if err != nil {
		return DesktopDockerResourcesResult{}, err
	}
	defer cleanup()
	if err := client.Ping(ctx); err != nil {
		return DesktopDockerResourcesResult{
			Stats:           []DesktopDockerContainerStats{},
			DockerInstalled: false,
			StatsLimit:      desktopDockerResourceStatsLimit,
			Error:           "Docker not installed or not accessible",
		}, nil
	}
	info, err := client.SystemInfo(ctx)
	if err != nil {
		return DesktopDockerResourcesResult{}, err
	}
	stats, runningTotal, err := client.Stats(ctx, desktopDockerResourceStatsLimit)
	if err != nil {
		return DesktopDockerResourcesResult{}, err
	}
	return DesktopDockerResourcesResult{
		Stats:             stats,
		SystemInfo:        info,
		DockerInstalled:   true,
		StatsTruncated:    runningTotal > len(stats),
		StatsLimit:        desktopDockerResourceStatsLimit,
		RunningStatsTotal: runningTotal,
	}, nil
}

func (s *DesktopDockerService) GetSystemInfo(input DesktopDockerServerInput) (DesktopDockerSystemInfo, error) {
	ctx, client, cleanup, err := s.client(input.ServerID, 30*time.Second)
	if err != nil {
		return DesktopDockerSystemInfo{}, err
	}
	defer cleanup()
	info, err := client.SystemInfo(ctx)
	if err != nil {
		return DesktopDockerSystemInfo{}, err
	}
	return *info, nil
}

type DesktopDockerStatsResult = dockerutil.StatsResult

func (s *DesktopDockerService) GetContainerStats(input DesktopDockerServerInput) (DesktopDockerStatsResult, error) {
	ctx, client, cleanup, err := s.client(input.ServerID, 45*time.Second)
	if err != nil {
		return DesktopDockerStatsResult{}, err
	}
	defer cleanup()
	stats, total, err := client.Stats(ctx, dockerutil.MaxStatsLimit)
	if err != nil {
		return DesktopDockerStatsResult{}, err
	}
	return DesktopDockerStatsResult{Data: stats, Total: total, Limit: dockerutil.MaxStatsLimit, Truncated: total > dockerutil.MaxStatsLimit}, nil
}

func (s *DesktopDockerService) GetContainerStat(input DesktopDockerContainerInput) (DesktopDockerContainerStats, error) {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return DesktopDockerContainerStats{}, err
	}
	ctx, client, cleanup, err := s.client(input.ServerID, 30*time.Second)
	if err != nil {
		return DesktopDockerContainerStats{}, err
	}
	defer cleanup()
	return client.ContainerStat(ctx, containerID)
}

func (s *DesktopDockerService) GetContainerLogs(input DesktopDockerContainerLogsInput) (DesktopDockerContainerLogsResult, error) {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return DesktopDockerContainerLogsResult{}, err
	}
	tail := dockerutil.NormalizeTail(input.Tail)
	encodingName := strings.TrimSpace(input.Encoding)
	if encodingName == "" {
		encodingName = "utf-8"
	}
	ctx, client, cleanup, err := s.client(input.ServerID, 30*time.Second)
	if err != nil {
		return DesktopDockerContainerLogsResult{}, err
	}
	defer cleanup()
	output, err := client.Logs(ctx, containerID, tail)
	if err != nil {
		return DesktopDockerContainerLogsResult{}, err
	}
	return DesktopDockerContainerLogsResult{
		Data:        textencoding.Decode(string(output), encodingName),
		ContainerID: containerID,
		Lines:       tail,
		Encoding:    encodingName,
	}, nil
}

func (s *DesktopDockerService) StartContainer(input DesktopDockerContainerInput) (protocol.DockerActionResult, error) {
	return s.containerAction(input, protocol.DockerActionStart, false)
}
func (s *DesktopDockerService) StopContainer(input DesktopDockerContainerInput) (protocol.DockerActionResult, error) {
	return s.containerAction(input, protocol.DockerActionStop, false)
}
func (s *DesktopDockerService) RestartContainer(input DesktopDockerContainerInput) (protocol.DockerActionResult, error) {
	return s.containerAction(input, protocol.DockerActionRestart, false)
}
func (s *DesktopDockerService) PauseContainer(input DesktopDockerContainerInput) (protocol.DockerActionResult, error) {
	return s.containerAction(input, protocol.DockerActionPause, false)
}
func (s *DesktopDockerService) UnpauseContainer(input DesktopDockerContainerInput) (protocol.DockerActionResult, error) {
	return s.containerAction(input, protocol.DockerActionUnpause, false)
}
func (s *DesktopDockerService) RemoveContainer(input DesktopDockerRemoveContainerInput) (protocol.DockerActionResult, error) {
	return s.containerAction(DesktopDockerContainerInput{ServerID: input.ServerID, ContainerID: input.ContainerID}, protocol.DockerActionRemove, input.Force)
}

func (s *DesktopDockerService) CheckImageUpdate(input DesktopDockerContainerInput) (DesktopDockerImageUpdateCheckResult, error) {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return DesktopDockerImageUpdateCheckResult{}, err
	}
	ctx, client, cleanup, err := s.client(input.ServerID, 45*time.Second)
	if err != nil {
		return DesktopDockerImageUpdateCheckResult{}, err
	}
	defer cleanup()
	update, err := client.CheckImageUpdate(ctx, containerID)
	if err != nil {
		return DesktopDockerImageUpdateCheckResult{}, err
	}
	return DesktopDockerImageUpdateCheckResult{
		HasUpdate:     update.HasUpdate,
		ImageName:     update.ImageName,
		ContainerName: update.ContainerName,
		UpdateCommand: update.UpdateCommand,
		Error:         update.Error,
	}, nil
}

func (s *DesktopDockerService) client(serverID string, timeout time.Duration) (context.Context, *dockerutil.Client, func(), error) {
	serverID, err := normalizeDesktopDockerServerID(serverID)
	if err != nil {
		return nil, nil, nil, err
	}
	lifetime, finish, err := s.beginOperation(context.Background())
	if err != nil {
		return nil, nil, nil, err
	}
	ctx, cancel := context.WithTimeout(lifetime, timeout)
	client, closeClient, err := s.openClient(ctx, serverID)
	if err != nil {
		cancel()
		finish()
		return nil, nil, nil, err
	}
	return ctx, client, func() { closeClient(); cancel(); finish() }, nil
}

// The caller owns the operation registration through final task persistence.
func (s *DesktopDockerService) openClient(ctx context.Context, serverID string) (*dockerutil.Client, func(), error) {
	sshClient, closeSSH, err := s.serverService.openSSHClientContext(ctx, serverID)
	if err != nil {
		return nil, nil, err
	}
	stopTransport := sftputil.CloseOnCancel(ctx, func() error { closeSSH(); return nil })
	client, err := dockerutil.NewClient(sshClient.DialContext, desktopDockerSocketPath)
	if err != nil {
		stopTransport()
		closeSSH()
		return nil, nil, err
	}
	return client, func() { _ = client.Close(); stopTransport(); closeSSH() }, nil
}

func normalizeDesktopDockerServerID(serverID string) (string, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return "", errors.New("server id is required")
	}
	return serverID, nil
}

func normalizeDesktopDockerContainerID(containerID string) (string, error) {
	return dockerutil.NormalizeContainerRef(containerID)
}

func (s *DesktopDockerService) ServiceShutdown() error {
	s.stopOperations()
	s.operationWG.Wait()
	return nil
}
