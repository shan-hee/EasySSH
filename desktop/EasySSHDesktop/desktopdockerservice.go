package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const desktopDockerSockNoCurlSentinel = "__EASYSSH_NO_CURL__"
const desktopDockerResourceStatsLimit = 50

var desktopDockerIdentifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]*$`)

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

type DesktopDockerContainer struct {
	ID      string               `json:"id"`
	Names   []string             `json:"names"`
	Image   string               `json:"image"`
	ImageID string               `json:"imageId"`
	Command string               `json:"command"`
	Created int64                `json:"created"`
	Status  string               `json:"status"`
	State   string               `json:"state"`
	Ports   []DesktopDockerPort  `json:"ports"`
	Labels  map[string]string    `json:"labels"`
	Mounts  []DesktopDockerMount `json:"mounts"`
}

type DesktopDockerPort struct {
	IP          string `json:"ip,omitempty"`
	PrivatePort int    `json:"privatePort"`
	PublicPort  int    `json:"publicPort,omitempty"`
	Type        string `json:"type"`
}

type DesktopDockerMount struct {
	Type        string `json:"type"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Mode        string `json:"mode"`
	RW          bool   `json:"rw"`
}

type DesktopDockerContainerStats struct {
	ContainerID   string  `json:"containerId"`
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryUsage   int64   `json:"memoryUsage"`
	MemoryLimit   int64   `json:"memoryLimit"`
	MemoryPercent float64 `json:"memoryPercent"`
	NetworkIn     int64   `json:"networkIn"`
	NetworkOut    int64   `json:"networkOut"`
	BlockRead     int64   `json:"blockRead"`
	BlockWrite    int64   `json:"blockWrite"`
	PIDs          int     `json:"pids"`
}

type DesktopDockerImage struct {
	ID          string `json:"id"`
	Repository  string `json:"repository"`
	Tag         string `json:"tag"`
	Created     int64  `json:"created"`
	Size        int64  `json:"size"`
	VirtualSize int64  `json:"virtualSize"`
}

type DesktopDockerSystemInfo struct {
	ContainersRunning int    `json:"containersRunning"`
	ContainersPaused  int    `json:"containersPaused"`
	ContainersStopped int    `json:"containersStopped"`
	ContainersTotal   int    `json:"containersTotal"`
	ImagesCount       int    `json:"imagesCount"`
	DockerVersion     string `json:"dockerVersion"`
	ServerVersion     string `json:"serverVersion"`
	StorageDriver     string `json:"storageDriver"`
	TotalMemory       int64  `json:"totalMemory"`
	CPUs              int    `json:"cpus"`
}

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

	images := parseDesktopDockerImages(output)
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

	output, err := s.executeSuccess(serverID, buildDesktopDockerResourcesScript(desktopDockerResourceStatsLimit), 30000)
	if err != nil {
		return DesktopDockerResourcesResult{}, err
	}

	sections := parseDesktopDockerSections(output)
	result := DesktopDockerResourcesResult{
		Stats:           []DesktopDockerContainerStats{},
		DockerInstalled: true,
		StatsLimit:      desktopDockerResourceStatsLimit,
	}
	if statsData, ok := sections["STATS"]; ok {
		result.Stats = parseDesktopDockerStats(statsData)
	}
	if infoData, ok := sections["INFO"]; ok {
		result.SystemInfo = parseDesktopDockerSystemInfo(infoData)
	}
	if metaData, ok := sections["STATS_META"]; ok {
		meta := parseDesktopDockerStatsMeta(metaData)
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

	info := parseDesktopDockerSystemInfo(output)
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
	return parseDesktopDockerStats(output), nil
}

func (s *DesktopDockerService) GetContainerStat(input DesktopDockerContainerInput) (DesktopDockerContainerStats, error) {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return DesktopDockerContainerStats{}, err
	}

	cmd := fmt.Sprintf("docker stats --no-stream --format '{{json .}}' %s", desktopDockerShellQuote(containerID))
	output, err := s.executeSuccess(input.ServerID, cmd, 30000)
	if err != nil {
		return DesktopDockerContainerStats{}, err
	}

	stats := parseDesktopDockerStats(output)
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

	tail := input.Tail
	if tail <= 0 {
		tail = 100
	}
	if tail > 5000 {
		tail = 5000
	}
	encoding := strings.TrimSpace(input.Encoding)
	if encoding == "" {
		encoding = "utf-8"
	}

	cmd := fmt.Sprintf("docker logs --tail %d %s 2>&1", tail, desktopDockerShellQuote(containerID))
	result, err := s.run(serverID, cmd, 30000)
	if err != nil {
		return DesktopDockerContainerLogsResult{}, err
	}
	if result.ExitCode != 0 && strings.TrimSpace(result.Output) == "" {
		return DesktopDockerContainerLogsResult{}, desktopDockerCommandError(result, "docker logs failed")
	}

	return DesktopDockerContainerLogsResult{
		Data:        result.Output,
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
	_, err = s.executeSuccess(input.ServerID, fmt.Sprintf("docker rm %s%s", flag, desktopDockerShellQuote(containerID)), 30000)
	return err
}

func (s *DesktopDockerService) CheckImageUpdate(input DesktopDockerContainerInput) (DesktopDockerImageUpdateCheckResult, error) {
	containerID, err := normalizeDesktopDockerContainerID(input.ContainerID)
	if err != nil {
		return DesktopDockerImageUpdateCheckResult{}, err
	}

	inspectCmd := fmt.Sprintf("docker inspect --format '{{.Name}}|{{.Config.Image}}' %s", desktopDockerShellQuote(containerID))
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
	quotedImage := desktopDockerShellQuote(imageName)

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

	_, err = s.executeSuccess(input.ServerID, fmt.Sprintf("docker %s %s", action, desktopDockerShellQuote(containerID)), 30000)
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

	containers, err := parseDesktopDockerContainersFromSock(output)
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
	meta := parseDesktopDockerPSMeta(metaOutput)

	idsOutput, err := s.executeSuccess(serverID, fmt.Sprintf("docker ps %s -q", psFlag), 20000)
	if err != nil {
		return nil, err
	}

	ids := splitDesktopDockerNonEmptyLines(idsOutput)
	if len(ids) == 0 {
		return []DesktopDockerContainer{}, nil
	}

	quotedIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		if _, err := normalizeDesktopDockerContainerID(id); err == nil {
			quotedIDs = append(quotedIDs, desktopDockerShellQuote(id))
		}
	}
	if len(quotedIDs) == 0 {
		return []DesktopDockerContainer{}, nil
	}

	inspectOutput, err := s.executeSuccess(serverID, fmt.Sprintf("docker inspect %s", strings.Join(quotedIDs, " ")), 30000)
	if err != nil {
		return nil, err
	}

	return parseDesktopDockerInspectContainers(inspectOutput, meta)
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

type desktopDockerStatsMeta struct {
	RunningTotal int `json:"RunningTotal"`
	StatsLimit   int `json:"StatsLimit"`
	StatsSampled int `json:"StatsSampled"`
}

func buildDesktopDockerResourcesScript(statsLimit int) string {
	if statsLimit <= 0 {
		statsLimit = desktopDockerResourceStatsLimit
	}
	return strings.ReplaceAll(`
_stats_limit=__EASYSSH_STATS_LIMIT__
echo "=== INFO ==="
docker info --format '{"Containers":{{.Containers}},"ContainersRunning":{{.ContainersRunning}},"ContainersPaused":{{.ContainersPaused}},"ContainersStopped":{{.ContainersStopped}},"Images":{{.Images}},"DockerVersion":"{{.ServerVersion}}","ServerVersion":"{{.ServerVersion}}","Driver":"{{.Driver}}","MemTotal":{{.MemTotal}},"NCPU":{{.NCPU}}}' 2>/dev/null || echo '{}'
_stats_ids=$(docker ps -q --no-trunc 2>/dev/null || true)
_stats_total=$(printf '%s\n' "$_stats_ids" | awk 'NF { n++ } END { print n + 0 }')
_stats_sample=$(printf '%s\n' "$_stats_ids" | awk -v limit="$_stats_limit" 'NF && n < limit { print; n++ }')
_stats_sampled=$(printf '%s\n' "$_stats_sample" | awk 'NF { n++ } END { print n + 0 }')
echo "=== STATS_META ==="
printf '{"RunningTotal":%s,"StatsLimit":%s,"StatsSampled":%s}\n' "${_stats_total:-0}" "$_stats_limit" "${_stats_sampled:-0}"
echo "=== STATS ==="
if [ -n "$_stats_sample" ]; then
  docker stats --no-stream --format '{{json .}}' $_stats_sample 2>/dev/null || true
fi
`, "__EASYSSH_STATS_LIMIT__", strconv.Itoa(statsLimit))
}

func parseDesktopDockerStatsMeta(data string) desktopDockerStatsMeta {
	var meta desktopDockerStatsMeta
	_ = json.Unmarshal([]byte(strings.TrimSpace(data)), &meta)
	return meta
}

type desktopDockerSockContainerSummary struct {
	ID      string                   `json:"Id"`
	Names   []string                 `json:"Names"`
	Image   string                   `json:"Image"`
	ImageID string                   `json:"ImageID"`
	Command string                   `json:"Command"`
	Created int64                    `json:"Created"`
	State   string                   `json:"State"`
	Status  string                   `json:"Status"`
	Ports   []DesktopDockerPort      `json:"Ports"`
	Labels  map[string]string        `json:"Labels"`
	Mounts  []desktopDockerSockMount `json:"Mounts"`
}

type desktopDockerSockMount struct {
	Type        string `json:"Type"`
	Source      string `json:"Source"`
	Destination string `json:"Destination"`
	Mode        string `json:"Mode"`
	RW          bool   `json:"RW"`
}

func parseDesktopDockerContainersFromSock(data string) ([]DesktopDockerContainer, error) {
	data = strings.TrimSpace(data)
	if data == "" || data == "[]" {
		return []DesktopDockerContainer{}, nil
	}

	var raw []desktopDockerSockContainerSummary
	if err := json.Unmarshal([]byte(data), &raw); err != nil {
		return nil, err
	}

	containers := make([]DesktopDockerContainer, 0, len(raw))
	for _, item := range raw {
		names := make([]string, 0, len(item.Names))
		for _, name := range item.Names {
			name = strings.TrimSpace(strings.TrimPrefix(name, "/"))
			if name != "" {
				names = append(names, name)
			}
		}

		mounts := make([]DesktopDockerMount, 0, len(item.Mounts))
		for _, mount := range item.Mounts {
			mounts = append(mounts, DesktopDockerMount{
				Type:        mount.Type,
				Source:      mount.Source,
				Destination: mount.Destination,
				Mode:        mount.Mode,
				RW:          mount.RW,
			})
		}

		labels := item.Labels
		if labels == nil {
			labels = map[string]string{}
		}

		containers = append(containers, DesktopDockerContainer{
			ID:      item.ID,
			Names:   names,
			Image:   item.Image,
			ImageID: item.ImageID,
			Command: item.Command,
			Created: item.Created,
			Status:  item.Status,
			State:   strings.ToLower(item.State),
			Ports:   item.Ports,
			Labels:  labels,
			Mounts:  mounts,
		})
	}

	return containers, nil
}

type desktopDockerPSMeta struct {
	Status string
	State  string
	Names  []string
}

type desktopDockerInspectPortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

type desktopDockerInspectContainer struct {
	ID      string   `json:"Id"`
	Name    string   `json:"Name"`
	Image   string   `json:"Image"`
	Created string   `json:"Created"`
	Path    string   `json:"Path"`
	Args    []string `json:"Args"`
	State   struct {
		Status string `json:"Status"`
	} `json:"State"`
	Config struct {
		Image  string            `json:"Image"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	NetworkSettings struct {
		Ports map[string][]desktopDockerInspectPortBinding `json:"Ports"`
	} `json:"NetworkSettings"`
	Mounts []struct {
		Type        string `json:"Type"`
		Source      string `json:"Source"`
		Destination string `json:"Destination"`
		Mode        string `json:"Mode"`
		RW          bool   `json:"RW"`
	} `json:"Mounts"`
}

func parseDesktopDockerInspectContainers(data string, meta map[string]desktopDockerPSMeta) ([]DesktopDockerContainer, error) {
	data = strings.TrimSpace(data)
	if data == "" {
		return []DesktopDockerContainer{}, nil
	}

	var inspected []desktopDockerInspectContainer
	if err := json.Unmarshal([]byte(data), &inspected); err != nil {
		return nil, err
	}

	containers := make([]DesktopDockerContainer, 0, len(inspected))
	for _, item := range inspected {
		labels := item.Config.Labels
		if labels == nil {
			labels = map[string]string{}
		}

		names := []string{}
		if metaItem, ok := meta[item.ID]; ok && len(metaItem.Names) > 0 {
			names = metaItem.Names
		} else if item.Name != "" {
			name := strings.TrimPrefix(strings.TrimSpace(item.Name), "/")
			if name != "" {
				names = []string{name}
			}
		}

		createdUnix := int64(0)
		if item.Created != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, item.Created); err == nil {
				createdUnix = parsed.Unix()
			} else if parsed, err := time.Parse(time.RFC3339, item.Created); err == nil {
				createdUnix = parsed.Unix()
			}
		}

		mounts := make([]DesktopDockerMount, 0, len(item.Mounts))
		for _, mount := range item.Mounts {
			mounts = append(mounts, DesktopDockerMount{
				Type:        mount.Type,
				Source:      mount.Source,
				Destination: mount.Destination,
				Mode:        mount.Mode,
				RW:          mount.RW,
			})
		}

		status := ""
		state := strings.ToLower(item.State.Status)
		if metaItem, ok := meta[item.ID]; ok {
			status = metaItem.Status
			if metaItem.State != "" {
				state = strings.ToLower(metaItem.State)
			}
		}
		if status == "" {
			status = item.State.Status
		}

		containers = append(containers, DesktopDockerContainer{
			ID:      item.ID,
			Names:   names,
			Image:   item.Config.Image,
			ImageID: item.Image,
			Command: strings.TrimSpace(strings.Join(append([]string{item.Path}, item.Args...), " ")),
			Created: createdUnix,
			Status:  status,
			State:   state,
			Ports:   parseDesktopDockerInspectPorts(item.NetworkSettings.Ports),
			Labels:  labels,
			Mounts:  mounts,
		})
	}

	return containers, nil
}

func parseDesktopDockerPSMeta(output string) map[string]desktopDockerPSMeta {
	result := map[string]desktopDockerPSMeta{}
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 4 {
			continue
		}
		id := strings.TrimSpace(parts[0])
		if id == "" {
			continue
		}
		names := []string{}
		for _, name := range strings.Split(parts[3], ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				names = append(names, name)
			}
		}
		result[id] = desktopDockerPSMeta{
			Status: strings.TrimSpace(parts[1]),
			State:  strings.TrimSpace(parts[2]),
			Names:  names,
		}
	}
	return result
}

func parseDesktopDockerInspectPorts(ports map[string][]desktopDockerInspectPortBinding) []DesktopDockerPort {
	if len(ports) == 0 {
		return []DesktopDockerPort{}
	}

	result := []DesktopDockerPort{}
	for containerPortSpec, bindings := range ports {
		spec := strings.TrimSpace(containerPortSpec)
		if spec == "" {
			continue
		}

		privateStr, proto := spec, "tcp"
		if strings.Contains(spec, "/") {
			parts := strings.SplitN(spec, "/", 2)
			privateStr = parts[0]
			if parts[1] != "" {
				proto = parts[1]
			}
		}

		privatePort, err := strconv.Atoi(privateStr)
		if err != nil || privatePort <= 0 {
			continue
		}

		if len(bindings) == 0 {
			result = append(result, DesktopDockerPort{PrivatePort: privatePort, Type: proto})
			continue
		}

		for _, binding := range bindings {
			publicPort, _ := strconv.Atoi(strings.TrimSpace(binding.HostPort))
			result = append(result, DesktopDockerPort{
				IP:          strings.TrimSpace(binding.HostIP),
				PrivatePort: privatePort,
				PublicPort:  publicPort,
				Type:        proto,
			})
		}
	}
	return result
}

func parseDesktopDockerSections(output string) map[string]string {
	sections := map[string]string{}
	var currentSection string
	sectionLines := []string{}

	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, "=== ") && strings.HasSuffix(line, " ===") {
			if currentSection != "" {
				sections[currentSection] = strings.Join(sectionLines, "\n")
			}
			currentSection = strings.Trim(line, "= ")
			sectionLines = []string{}
			continue
		}
		if currentSection != "" {
			sectionLines = append(sectionLines, line)
		}
	}

	if currentSection != "" {
		sections[currentSection] = strings.Join(sectionLines, "\n")
	}
	return sections
}

func parseDesktopDockerStats(data string) []DesktopDockerContainerStats {
	stats := []DesktopDockerContainerStats{}
	for _, line := range strings.Split(strings.TrimSpace(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == "[]" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		memoryUsage, memoryLimit := parseDesktopDockerMemoryPair(getDesktopDockerString(raw, "MemUsage"))
		networkIn, networkOut := parseDesktopDockerSizePair(getDesktopDockerString(raw, "NetIO"))
		blockRead, blockWrite := parseDesktopDockerSizePair(getDesktopDockerString(raw, "BlockIO"))
		pids, _ := strconv.Atoi(getDesktopDockerString(raw, "PIDs"))

		stats = append(stats, DesktopDockerContainerStats{
			ContainerID:   getDesktopDockerString(raw, "ID"),
			Name:          getDesktopDockerString(raw, "Name"),
			CPUPercent:    parseDesktopDockerPercent(getDesktopDockerString(raw, "CPUPerc")),
			MemoryUsage:   memoryUsage,
			MemoryLimit:   memoryLimit,
			MemoryPercent: parseDesktopDockerPercent(getDesktopDockerString(raw, "MemPerc")),
			NetworkIn:     networkIn,
			NetworkOut:    networkOut,
			BlockRead:     blockRead,
			BlockWrite:    blockWrite,
			PIDs:          pids,
		})
	}
	return stats
}

func parseDesktopDockerImages(data string) []DesktopDockerImage {
	images := []DesktopDockerImage{}
	for _, line := range strings.Split(strings.TrimSpace(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == "[]" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		createdUnix := int64(0)
		if createdAt := getDesktopDockerString(raw, "CreatedAt"); createdAt != "" {
			if parsed, err := time.Parse("2006-01-02 15:04:05 -0700 MST", createdAt); err == nil {
				createdUnix = parsed.Unix()
			}
		}

		size := parseDesktopDockerSize(getDesktopDockerString(raw, "Size"))
		virtualSize := parseDesktopDockerSize(getDesktopDockerString(raw, "VirtualSize"))
		if virtualSize == 0 {
			virtualSize = size
		}

		images = append(images, DesktopDockerImage{
			ID:          getDesktopDockerString(raw, "ID"),
			Repository:  getDesktopDockerString(raw, "Repository"),
			Tag:         getDesktopDockerString(raw, "Tag"),
			Created:     createdUnix,
			Size:        size,
			VirtualSize: virtualSize,
		})
	}
	return images
}

func parseDesktopDockerSystemInfo(data string) *DesktopDockerSystemInfo {
	data = strings.TrimSpace(data)
	if data == "" || data == "{}" {
		return nil
	}

	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(data), &raw); err != nil {
		return nil
	}

	serverVersion := getDesktopDockerString(raw, "ServerVersion")
	dockerVersion := getDesktopDockerString(raw, "DockerVersion")
	if dockerVersion == "" {
		dockerVersion = serverVersion
	}

	return &DesktopDockerSystemInfo{
		ContainersRunning: getDesktopDockerInt(raw, "ContainersRunning"),
		ContainersPaused:  getDesktopDockerInt(raw, "ContainersPaused"),
		ContainersStopped: getDesktopDockerInt(raw, "ContainersStopped"),
		ContainersTotal:   getDesktopDockerInt(raw, "Containers"),
		ImagesCount:       getDesktopDockerInt(raw, "Images"),
		DockerVersion:     dockerVersion,
		ServerVersion:     serverVersion,
		StorageDriver:     getDesktopDockerString(raw, "Driver"),
		TotalMemory:       getDesktopDockerInt64(raw, "MemTotal"),
		CPUs:              getDesktopDockerInt(raw, "NCPU"),
	}
}

func normalizeDesktopDockerServerID(serverID string) (string, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return "", errors.New("server id is required")
	}
	return serverID, nil
}

func normalizeDesktopDockerContainerID(containerID string) (string, error) {
	containerID = strings.TrimSpace(strings.TrimPrefix(containerID, "/"))
	if containerID == "" {
		return "", errors.New("container id is required")
	}
	if !desktopDockerIdentifierPattern.MatchString(containerID) {
		return "", errors.New("container id contains invalid characters")
	}
	return containerID, nil
}

func desktopDockerCommandError(result DesktopServerCommandResult, fallback string) error {
	message := strings.TrimSpace(result.Output)
	if message == "" {
		message = fmt.Sprintf("%s with exit code %d", fallback, result.ExitCode)
	}
	return errors.New(message)
}

func desktopDockerShellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func splitDesktopDockerNonEmptyLines(output string) []string {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line != "" {
			result = append(result, line)
		}
	}
	return result
}

func getDesktopDockerString(data map[string]interface{}, key string) string {
	if value, ok := data[key]; ok {
		switch item := value.(type) {
		case string:
			return item
		case fmt.Stringer:
			return item.String()
		}
	}
	return ""
}

func getDesktopDockerInt(data map[string]interface{}, key string) int {
	if value, ok := data[key]; ok {
		switch item := value.(type) {
		case float64:
			return int(item)
		case int:
			return item
		case int64:
			return int(item)
		}
	}
	return 0
}

func getDesktopDockerInt64(data map[string]interface{}, key string) int64 {
	if value, ok := data[key]; ok {
		switch item := value.(type) {
		case float64:
			return int64(item)
		case int:
			return int64(item)
		case int64:
			return item
		}
	}
	return 0
}

func parseDesktopDockerPercent(value string) float64 {
	value = strings.TrimSpace(strings.TrimSuffix(value, "%"))
	parsed, _ := strconv.ParseFloat(value, 64)
	return parsed
}

func parseDesktopDockerMemoryPair(value string) (int64, int64) {
	return parseDesktopDockerSizePair(value)
}

func parseDesktopDockerSizePair(value string) (int64, int64) {
	parts := strings.Split(value, " / ")
	if len(parts) != 2 {
		return 0, 0
	}
	return parseDesktopDockerSize(parts[0]), parseDesktopDockerSize(parts[1])
}

func parseDesktopDockerSize(value string) int64 {
	value = strings.TrimSpace(strings.ToUpper(value))
	if value == "" {
		return 0
	}

	multiplier := int64(1)
	if strings.HasSuffix(value, "B") {
		value = strings.TrimSuffix(value, "B")
	}
	if strings.HasSuffix(value, "I") {
		value = strings.TrimSuffix(value, "I")
	}

	switch {
	case strings.HasSuffix(value, "K"):
		multiplier = 1024
		value = strings.TrimSuffix(value, "K")
	case strings.HasSuffix(value, "M"):
		multiplier = 1024 * 1024
		value = strings.TrimSuffix(value, "M")
	case strings.HasSuffix(value, "G"):
		multiplier = 1024 * 1024 * 1024
		value = strings.TrimSuffix(value, "G")
	case strings.HasSuffix(value, "T"):
		multiplier = 1024 * 1024 * 1024 * 1024
		value = strings.TrimSuffix(value, "T")
	}

	parsed, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return int64(parsed * float64(multiplier))
}
