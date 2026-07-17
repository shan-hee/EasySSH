package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/dockerutil"
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

type DesktopDockerContainersResult struct {
	Data  []DesktopDockerContainer `json:"data"`
	Total int                      `json:"total"`
}

type DesktopDockerImagesResult struct {
	Data  []DesktopDockerImage `json:"data"`
	Total int                  `json:"total"`
}

type DesktopDockerContainerLogsResult struct {
	Data        string `json:"data"`
	ContainerID string `json:"container_id"`
	Lines       int    `json:"lines"`
	Encoding    string `json:"encoding"`
}

type DesktopDockerResourcesResult struct {
	Stats             []DesktopDockerContainerStats `json:"stats"`
	SystemInfo        *DesktopDockerSystemInfo      `json:"systemInfo"`
	DockerInstalled   bool                          `json:"dockerInstalled"`
	StatsTruncated    bool                          `json:"statsTruncated"`
	StatsLimit        int                           `json:"statsLimit"`
	RunningStatsTotal int                           `json:"runningStatsTotal"`
	Error             string                        `json:"error,omitempty"`
}

type DesktopDockerImageUpdateCheckResult struct {
	HasUpdate     bool   `json:"hasUpdate"`
	ImageName     string `json:"imageName"`
	ContainerName string `json:"containerName"`
	UpdateCommand string `json:"updateCommand"`
	Error         string `json:"error,omitempty"`
}

type DesktopDockerService struct {
	serverService *DesktopServerService
}

func NewDesktopDockerService(serverService *DesktopServerService) *DesktopDockerService {
	return &DesktopDockerService{serverService: serverService}
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

func (s *DesktopDockerService) GetContainerStats(input DesktopDockerServerInput) ([]DesktopDockerContainerStats, error) {
	ctx, client, cleanup, err := s.client(input.ServerID, 2*time.Minute)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	stats, _, err := client.Stats(ctx, -1)
	return stats, err
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

func (s *DesktopDockerService) StartContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, (*dockerutil.Client).Start)
}

func (s *DesktopDockerService) StopContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, (*dockerutil.Client).Stop)
}

func (s *DesktopDockerService) RestartContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, (*dockerutil.Client).Restart)
}

func (s *DesktopDockerService) PauseContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, (*dockerutil.Client).Pause)
}

func (s *DesktopDockerService) UnpauseContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, (*dockerutil.Client).Unpause)
}

func (s *DesktopDockerService) RemoveContainer(input DesktopDockerRemoveContainerInput) error {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return err
	}
	ctx, client, cleanup, err := s.client(input.ServerID, 30*time.Second)
	if err != nil {
		return err
	}
	defer cleanup()
	return client.Remove(ctx, containerID, input.Force)
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

func (s *DesktopDockerService) containerAction(input DesktopDockerContainerInput, action func(*dockerutil.Client, context.Context, string) error) error {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return err
	}
	ctx, client, cleanup, err := s.client(input.ServerID, 30*time.Second)
	if err != nil {
		return err
	}
	defer cleanup()
	return action(client, ctx, containerID)
}

func (s *DesktopDockerService) client(serverID string, timeout time.Duration) (context.Context, *dockerutil.Client, func(), error) {
	serverID, err := normalizeDesktopDockerServerID(serverID)
	if err != nil {
		return nil, nil, nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	sshClient, closeSSH, err := s.serverService.openSSHClientContext(ctx, serverID)
	if err != nil {
		cancel()
		return nil, nil, nil, err
	}
	dockerClient, err := dockerutil.NewClient(sshClient.DialContext, desktopDockerSocketPath)
	if err != nil {
		closeSSH()
		cancel()
		return nil, nil, nil, err
	}
	cleanup := func() {
		_ = dockerClient.Close()
		closeSSH()
		cancel()
	}
	return ctx, dockerClient, cleanup, nil
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
