package main

import (
	"errors"
	"fmt"
	"strings"

	"github.com/easyssh/shared/dockerutil"
	"github.com/easyssh/shared/textencoding"
)

const desktopDockerSockNoCurlSentinel = "__EASYSSH_NO_CURL__"
const desktopDockerResourceStatsLimit = dockerutil.DefaultResourceStatsLimit

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
	serverID, err := normalizeDesktopDockerServerID(input.ServerID)
	if err != nil {
		return DesktopDockerContainersResult{}, err
	}

	containers, ok, err := s.listContainersViaDockerSock(serverID, input.All)
	if err != nil {
		return DesktopDockerContainersResult{}, err
	}
	if !ok {
		containers, err = s.listContainersViaInspect(serverID, input.All)
		if err != nil {
			return DesktopDockerContainersResult{}, err
		}
	}

	return DesktopDockerContainersResult{Data: containers, Total: len(containers)}, nil
}

func (s *DesktopDockerService) ListImages(input DesktopDockerServerInput) (DesktopDockerImagesResult, error) {
	output, err := s.executeSuccess(input.ServerID, "docker images --format '{{json .}}'", 20000)
	if err != nil {
		return DesktopDockerImagesResult{}, err
	}

	images := dockerutil.ParseImages(output)
	return DesktopDockerImagesResult{Data: images, Total: len(images)}, nil
}

func (s *DesktopDockerService) GetResources(input DesktopDockerServerInput) (DesktopDockerResourcesResult, error) {
	serverID, err := normalizeDesktopDockerServerID(input.ServerID)
	if err != nil {
		return DesktopDockerResourcesResult{}, err
	}

	check, err := s.run(serverID, "command -v docker >/dev/null 2>&1", 10000)
	if err != nil {
		return DesktopDockerResourcesResult{}, err
	}
	if check.ExitCode != 0 {
		return DesktopDockerResourcesResult{
			Stats:           []DesktopDockerContainerStats{},
			SystemInfo:      nil,
			DockerInstalled: false,
			StatsLimit:      desktopDockerResourceStatsLimit,
			Error:           "Docker not installed or not accessible",
		}, nil
	}

	output, err := s.executeSuccess(serverID, dockerutil.BuildResourcesScript(desktopDockerResourceStatsLimit), 30000)
	if err != nil {
		return DesktopDockerResourcesResult{}, err
	}

	sections := dockerutil.ParseSections(output)
	result := DesktopDockerResourcesResult{
		Stats:           []DesktopDockerContainerStats{},
		DockerInstalled: true,
		StatsLimit:      desktopDockerResourceStatsLimit,
	}
	if statsData, ok := sections["STATS"]; ok {
		result.Stats = dockerutil.ParseStats(statsData)
	}
	if infoData, ok := sections["INFO"]; ok {
		result.SystemInfo = dockerutil.ParseSystemInfo(infoData)
	}
	if metaData, ok := sections["STATS_META"]; ok {
		meta := dockerutil.ParseStatsMeta(metaData)
		if meta.StatsLimit > 0 {
			result.StatsLimit = meta.StatsLimit
		}
		result.RunningStatsTotal = meta.RunningTotal
		result.StatsTruncated = meta.RunningTotal > meta.StatsSampled
	}
	if result.RunningStatsTotal == 0 {
		result.RunningStatsTotal = len(result.Stats)
	}

	return result, nil
}

func (s *DesktopDockerService) GetSystemInfo(input DesktopDockerServerInput) (DesktopDockerSystemInfo, error) {
	output, err := s.executeSuccess(input.ServerID, `docker info --format '{"Containers":{{.Containers}},"ContainersRunning":{{.ContainersRunning}},"ContainersPaused":{{.ContainersPaused}},"ContainersStopped":{{.ContainersStopped}},"Images":{{.Images}},"DockerVersion":"{{.ServerVersion}}","ServerVersion":"{{.ServerVersion}}","Driver":"{{.Driver}}","MemTotal":{{.MemTotal}},"NCPU":{{.NCPU}}}'`, 20000)
	if err != nil {
		return DesktopDockerSystemInfo{}, err
	}

	info := dockerutil.ParseSystemInfo(output)
	if info == nil {
		return DesktopDockerSystemInfo{}, errors.New("failed to parse docker system info")
	}
	return *info, nil
}

func (s *DesktopDockerService) GetContainerStats(input DesktopDockerServerInput) ([]DesktopDockerContainerStats, error) {
	output, err := s.executeSuccess(input.ServerID, "docker stats --no-stream --format '{{json .}}'", 30000)
	if err != nil {
		return nil, err
	}
	return dockerutil.ParseStats(output), nil
}

func (s *DesktopDockerService) GetContainerStat(input DesktopDockerContainerInput) (DesktopDockerContainerStats, error) {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return DesktopDockerContainerStats{}, err
	}

	cmd := fmt.Sprintf("docker stats --no-stream --format '{{json .}}' %s", dockerutil.ShellQuote(containerID))
	output, err := s.executeSuccess(input.ServerID, cmd, 30000)
	if err != nil {
		return DesktopDockerContainerStats{}, err
	}

	stats := dockerutil.ParseStats(output)
	if len(stats) == 0 {
		return DesktopDockerContainerStats{}, errors.New("container stats not found")
	}
	return stats[0], nil
}

func (s *DesktopDockerService) GetContainerLogs(input DesktopDockerContainerLogsInput) (DesktopDockerContainerLogsResult, error) {
	serverID, err := normalizeDesktopDockerServerID(input.ServerID)
	if err != nil {
		return DesktopDockerContainerLogsResult{}, err
	}
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return DesktopDockerContainerLogsResult{}, err
	}

	tail := dockerutil.NormalizeTail(input.Tail)
	encoding := strings.TrimSpace(input.Encoding)
	if encoding == "" {
		encoding = "utf-8"
	}

	cmd := fmt.Sprintf("docker logs --tail %d %s 2>&1", tail, dockerutil.ShellQuote(containerID))
	result, err := s.run(serverID, cmd, 30000)
	if err != nil {
		return DesktopDockerContainerLogsResult{}, err
	}
	if result.ExitCode != 0 && strings.TrimSpace(result.Output) == "" {
		return DesktopDockerContainerLogsResult{}, desktopDockerCommandError(result, "docker logs failed")
	}

	return DesktopDockerContainerLogsResult{
		Data:        textencoding.Decode(result.Output, encoding),
		ContainerID: containerID,
		Lines:       tail,
		Encoding:    encoding,
	}, nil
}

func (s *DesktopDockerService) StartContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, "start")
}

func (s *DesktopDockerService) StopContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, "stop")
}

func (s *DesktopDockerService) RestartContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, "restart")
}

func (s *DesktopDockerService) PauseContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, "pause")
}

func (s *DesktopDockerService) UnpauseContainer(input DesktopDockerContainerInput) error {
	return s.containerAction(input, "unpause")
}

func (s *DesktopDockerService) RemoveContainer(input DesktopDockerRemoveContainerInput) error {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return err
	}

	flag := ""
	if input.Force {
		flag = "-f "
	}
	_, err = s.executeSuccess(input.ServerID, fmt.Sprintf("docker rm %s%s", flag, dockerutil.ShellQuote(containerID)), 30000)
	return err
}

func (s *DesktopDockerService) CheckImageUpdate(input DesktopDockerContainerInput) (DesktopDockerImageUpdateCheckResult, error) {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return DesktopDockerImageUpdateCheckResult{}, err
	}

	inspectCmd := fmt.Sprintf("docker inspect --format '{{.Name}}|{{.Config.Image}}' %s", dockerutil.ShellQuote(containerID))
	output, err := s.executeSuccess(input.ServerID, inspectCmd, 20000)
	if err != nil {
		return DesktopDockerImageUpdateCheckResult{}, err
	}

	parts := strings.SplitN(strings.TrimSpace(output), "|", 2)
	if len(parts) != 2 {
		return DesktopDockerImageUpdateCheckResult{}, errors.New("failed to parse container image info")
	}

	containerName := strings.TrimPrefix(strings.TrimSpace(parts[0]), "/")
	imageName := strings.TrimSpace(parts[1])
	if !dockerutil.ValidateImageRef(imageName) {
		return DesktopDockerImageUpdateCheckResult{}, errors.New("image name contains invalid characters")
	}
	quotedImage := dockerutil.ShellQuote(imageName)

	localDigestOutput, _ := s.executeSuccess(input.ServerID, fmt.Sprintf("docker image inspect %s --format '{{index .RepoDigests 0}}' 2>/dev/null || true", quotedImage), 20000)
	localDigest := strings.TrimSpace(localDigestOutput)
	if idx := strings.Index(localDigest, "@"); idx != -1 {
		localDigest = localDigest[idx+1:]
	}

	remoteDigestOutput, _ := s.executeSuccess(input.ServerID, fmt.Sprintf("docker manifest inspect %s 2>/dev/null | grep -m1 '\"digest\"' | cut -d'\"' -f4 || true", quotedImage), 30000)
	remoteDigest := strings.TrimSpace(remoteDigestOutput)

	hasUpdate := false
	errorMessage := ""
	if localDigest == "" && remoteDigest == "" {
		errorMessage = "无法检查更新：可能是本地构建的镜像或需要登录私有仓库"
	} else if remoteDigest == "" {
		errorMessage = "无法获取远程镜像信息，请确保网络连接正常且已登录镜像仓库"
	} else if localDigest == "" || localDigest != remoteDigest {
		hasUpdate = true
	}

	return DesktopDockerImageUpdateCheckResult{
		HasUpdate:     hasUpdate,
		ImageName:     imageName,
		ContainerName: containerName,
		UpdateCommand: "docker pull " + imageName,
		Error:         errorMessage,
	}, nil
}

func (s *DesktopDockerService) containerAction(input DesktopDockerContainerInput, action string) error {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return err
	}

	_, err = s.executeSuccess(input.ServerID, fmt.Sprintf("docker %s %s", action, dockerutil.ShellQuote(containerID)), 30000)
	return err
}

func (s *DesktopDockerService) listContainersViaDockerSock(serverID string, all bool) ([]DesktopDockerContainer, bool, error) {
	allFlag := 0
	if all {
		allFlag = 1
	}

	cmd := fmt.Sprintf(`if command -v curl >/dev/null 2>&1; then curl -sS --fail --max-time 5 --unix-socket /var/run/docker.sock "http://localhost/containers/json?all=%d"; else echo "%s"; fi`, allFlag, desktopDockerSockNoCurlSentinel)
	result, err := s.run(serverID, cmd, 15000)
	if err != nil {
		return nil, false, err
	}
	if result.ExitCode != 0 {
		return nil, false, nil
	}

	output := strings.TrimSpace(result.Output)
	if output == desktopDockerSockNoCurlSentinel {
		return nil, false, nil
	}

	containers, err := dockerutil.ParseContainersFromSock(output)
	if err != nil {
		return nil, true, err
	}
	return containers, true, nil
}

func (s *DesktopDockerService) listContainersViaInspect(serverID string, all bool) ([]DesktopDockerContainer, error) {
	psFlag := ""
	if all {
		psFlag = "-a"
	}

	metaCommand := fmt.Sprintf("docker ps %s --no-trunc --format '{{.ID}}\t{{.Status}}\t{{.State}}\t{{.Names}}'", psFlag)
	metaOutput, err := s.executeSuccess(serverID, metaCommand, 20000)
	if err != nil {
		return nil, err
	}
	meta := dockerutil.ParsePSMeta(metaOutput)

	idsOutput, err := s.executeSuccess(serverID, fmt.Sprintf("docker ps %s -q", psFlag), 20000)
	if err != nil {
		return nil, err
	}

	ids := dockerutil.SplitNonEmptyLines(idsOutput)
	if len(ids) == 0 {
		return []DesktopDockerContainer{}, nil
	}

	quotedIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		if _, err := normalizeDesktopDockerContainerID(id); err == nil {
			quotedIDs = append(quotedIDs, dockerutil.ShellQuote(id))
		}
	}
	if len(quotedIDs) == 0 {
		return []DesktopDockerContainer{}, nil
	}

	inspectOutput, err := s.executeSuccess(serverID, fmt.Sprintf("docker inspect %s", strings.Join(quotedIDs, " ")), 30000)
	if err != nil {
		return nil, err
	}

	return dockerutil.ParseInspectContainers(inspectOutput, meta)
}

func (s *DesktopDockerService) run(serverID string, command string, timeoutMs int) (DesktopServerCommandResult, error) {
	serverID, err := normalizeDesktopDockerServerID(serverID)
	if err != nil {
		return DesktopServerCommandResult{}, err
	}

	result, err := s.serverService.ExecuteCommand(DesktopServerCommandInput{
		ServerID:  serverID,
		Command:   command,
		TimeoutMs: timeoutMs,
	})
	if err != nil {
		return DesktopServerCommandResult{}, err
	}
	return result, nil
}

func (s *DesktopDockerService) executeSuccess(serverID string, command string, timeoutMs int) (string, error) {
	result, err := s.run(serverID, command, timeoutMs)
	if err != nil {
		return "", err
	}
	if result.ExitCode != 0 {
		return "", desktopDockerCommandError(result, "docker command failed")
	}
	return result.Output, nil
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

func desktopDockerCommandError(result DesktopServerCommandResult, fallback string) error {
	message := strings.TrimSpace(result.Output)
	if message == "" {
		message = fmt.Sprintf("%s with exit code %d", fallback, result.ExitCode)
	}
	return errors.New(message)
}
