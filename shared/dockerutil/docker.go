package dockerutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/distribution/reference"
	containertypes "github.com/moby/moby/api/types/container"
	mobyclient "github.com/moby/moby/client"
)

const DefaultResourceStatsLimit = 50
const MaxStatsLimit = 256
const MaxLogTail = 5000

type Container = protocol.DockerContainer

type Port = protocol.DockerPort

type Mount = protocol.DockerMount

type ContainerStats = protocol.DockerContainerStats

type Image = protocol.DockerImage

type SystemInfo = protocol.DockerSystemInfo

type ImageUpdate struct {
	HasUpdate     bool
	ImageName     string
	ContainerName string
	UpdateCommand string
	Error         string
}

type DialContextFunc func(context.Context, string, string) (net.Conn, error)

type Client struct {
	api       *mobyclient.Client
	transport *http.Transport
}

func NewClient(dial DialContextFunc, socketPath string) (*Client, error) {
	if dial == nil {
		return nil, errors.New("docker dialer is required")
	}
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" {
		return nil, errors.New("docker socket path is required")
	}

	transport := &http.Transport{
		DialContext:  func(ctx context.Context, _, _ string) (net.Conn, error) { return dial(ctx, "unix", socketPath) },
		MaxIdleConns: 6, MaxIdleConnsPerHost: 6, MaxConnsPerHost: 8,
		IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 45 * time.Second, MaxResponseHeaderBytes: 64 << 10,
	}
	httpClient := &http.Client{Transport: &boundedTransport{base: transport}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Docker redirects are disabled") }}
	api, err := mobyclient.New(
		mobyclient.WithHost("unix://"+socketPath),
		mobyclient.WithAPIVersionNegotiation(),
		mobyclient.WithHTTPClient(httpClient),
	)
	if err != nil {
		return nil, fmt.Errorf("create docker client: %w", err)
	}
	return &Client{api: api, transport: transport}, nil
}

func (c *Client) Close() error {
	if c.transport != nil {
		c.transport.CloseIdleConnections()
	}
	return c.api.Close()
}

func (c *Client) Ping(ctx context.Context) error {
	_, err := c.api.Ping(ctx, mobyclient.PingOptions{NegotiateAPIVersion: true})
	return err
}

func (c *Client) ListContainers(ctx context.Context, all bool) ([]Container, error) {
	result, err := c.api.ContainerList(ctx, mobyclient.ContainerListOptions{All: all})
	if err != nil {
		return nil, err
	}

	if len(result.Items) > MaxListItems {
		return nil, ErrResponseTooLarge
	}
	containers := make([]Container, 0, len(result.Items))
	for _, item := range result.Items {
		names := make([]string, 0, len(item.Names))
		for _, name := range item.Names {
			name = strings.TrimSpace(strings.TrimPrefix(name, "/"))
			if name != "" {
				names = append(names, name)
			}
		}

		ports := make([]Port, 0, len(item.Ports))
		for _, port := range item.Ports {
			ip := ""
			if port.IP.IsValid() {
				ip = port.IP.String()
			}
			ports = append(ports, Port{
				IP:          ip,
				PrivatePort: int(port.PrivatePort),
				PublicPort:  int(port.PublicPort),
				Type:        port.Type,
			})
		}

		mounts := make([]Mount, 0, len(item.Mounts))
		for _, mount := range item.Mounts {
			mounts = append(mounts, Mount{
				Type:        string(mount.Type),
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
		containers = append(containers, Container{
			ID:      item.ID,
			Names:   names,
			Image:   item.Image,
			ImageID: item.ImageID,
			Command: item.Command,
			Created: item.Created,
			Status:  item.Status,
			State:   strings.ToLower(string(item.State)),
			Ports:   ports,
			Labels:  labels,
			Mounts:  mounts,
		})
	}
	return containers, nil
}

func (c *Client) Logs(ctx context.Context, containerID string, tail int) ([]byte, error) {
	containerID, err := NormalizeContainerRef(containerID)
	if err != nil {
		return nil, err
	}
	tail = NormalizeTail(tail)

	inspect, err := c.api.ContainerInspect(ctx, containerID, mobyclient.ContainerInspectOptions{})
	if err != nil {
		return nil, err
	}
	logs, err := c.api.ContainerLogs(ctx, containerID, mobyclient.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       strconv.Itoa(tail),
	})
	if err != nil {
		return nil, err
	}
	defer logs.Close()

	return readDockerLogs(logs, inspect.Container.Config != nil && inspect.Container.Config.Tty)
}

func (c *Client) Start(ctx context.Context, containerID string) error {
	return c.Apply(ctx, protocol.DockerActionStart, containerID, false)
}
func (c *Client) Stop(ctx context.Context, containerID string) error {
	return c.Apply(ctx, protocol.DockerActionStop, containerID, false)
}
func (c *Client) Restart(ctx context.Context, containerID string) error {
	return c.Apply(ctx, protocol.DockerActionRestart, containerID, false)
}
func (c *Client) Remove(ctx context.Context, containerID string, force bool) error {
	return c.Apply(ctx, protocol.DockerActionRemove, containerID, force)
}

func (c *Client) ListImages(ctx context.Context) ([]Image, error) {
	result, err := c.api.ImageList(ctx, mobyclient.ImageListOptions{})
	if err != nil {
		return nil, err
	}

	if len(result.Items) > MaxListItems {
		return nil, ErrResponseTooLarge
	}
	images := make([]Image, 0, len(result.Items))
	for _, item := range result.Items {
		if len(images)+max(1, len(item.RepoTags)) > MaxListItems {
			return nil, ErrResponseTooLarge
		}
		repoTags := item.RepoTags
		if len(repoTags) == 0 {
			repoTags = []string{"<none>:<none>"}
		}
		for _, repoTag := range repoTags {
			repository, tag := splitRepoTag(repoTag)
			images = append(images, Image{
				ID:          item.ID,
				Repository:  repository,
				Tag:         tag,
				Created:     item.Created,
				Size:        item.Size,
				VirtualSize: item.Size,
			})
		}
	}
	return images, nil
}

func (c *Client) SystemInfo(ctx context.Context) (*SystemInfo, error) {
	result, err := c.api.Info(ctx, mobyclient.InfoOptions{})
	if err != nil {
		return nil, err
	}
	info := result.Info
	return &SystemInfo{
		ContainersRunning: info.ContainersRunning,
		ContainersPaused:  info.ContainersPaused,
		ContainersStopped: info.ContainersStopped,
		ContainersTotal:   info.Containers,
		ImagesCount:       info.Images,
		DockerVersion:     info.ServerVersion,
		ServerVersion:     info.ServerVersion,
		StorageDriver:     info.Driver,
		TotalMemory:       info.MemTotal,
		CPUs:              info.NCPU,
	}, nil
}

func (c *Client) Stats(ctx context.Context, limit int) ([]ContainerStats, int, error) {
	if limit == 0 {
		limit = DefaultResourceStatsLimit
	}
	if limit < 1 || limit > MaxStatsLimit {
		return nil, 0, errors.New("Docker stats limit must be between 1 and 256")
	}
	listed, err := c.api.ContainerList(ctx, mobyclient.ContainerListOptions{})
	if err != nil {
		return nil, 0, err
	}
	if len(listed.Items) > MaxListItems {
		return nil, 0, ErrResponseTooLarge
	}
	runningTotal := len(listed.Items)
	if limit > 0 && len(listed.Items) > limit {
		listed.Items = listed.Items[:limit]
	}

	stats := make([]ContainerStats, len(listed.Items))
	valid := make([]bool, len(listed.Items))
	semaphore := make(chan struct{}, 8)
	var wait sync.WaitGroup
	for i, item := range listed.Items {
		wait.Add(1)
		go func(index int, id string) {
			defer wait.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			stat, statErr := c.ContainerStat(ctx, id)
			if statErr == nil {
				stats[index] = stat
				valid[index] = true
			}
		}(i, item.ID)
	}
	wait.Wait()

	result := make([]ContainerStats, 0, len(stats))
	for i, stat := range stats {
		if valid[i] {
			result = append(result, stat)
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, runningTotal, err
	}
	if missing := len(stats) - len(result); missing > 0 {
		return result, runningTotal, fmt.Errorf("could not collect statistics for %d of %d selected containers", missing, len(stats))
	}
	return result, runningTotal, nil
}

func (c *Client) ContainerStat(ctx context.Context, containerID string) (ContainerStats, error) {
	containerID, err := NormalizeContainerRef(containerID)
	if err != nil {
		return ContainerStats{}, err
	}
	result, err := c.api.ContainerStats(ctx, containerID, mobyclient.ContainerStatsOptions{
		IncludePreviousSample: true,
	})
	if err != nil {
		return ContainerStats{}, err
	}
	defer result.Body.Close()

	var response containertypes.StatsResponse
	if err := json.NewDecoder(result.Body).Decode(&response); err != nil {
		return ContainerStats{}, err
	}
	return convertStats(response), nil
}

func (c *Client) CheckImageUpdate(ctx context.Context, containerID string) (ImageUpdate, error) {
	containerID, err := NormalizeContainerRef(containerID)
	if err != nil {
		return ImageUpdate{}, err
	}
	containerResult, err := c.api.ContainerInspect(ctx, containerID, mobyclient.ContainerInspectOptions{})
	if err != nil {
		return ImageUpdate{}, err
	}
	if containerResult.Container.Config == nil {
		return ImageUpdate{}, errors.New("container image configuration is missing")
	}

	containerName := strings.TrimPrefix(containerResult.Container.Name, "/")
	imageName := strings.TrimSpace(containerResult.Container.Config.Image)
	if !ValidateImageRef(imageName) {
		return ImageUpdate{}, errors.New("image name contains invalid characters")
	}
	update := ImageUpdate{
		ImageName:     imageName,
		ContainerName: containerName,
		UpdateCommand: "docker pull " + imageName,
	}

	localDigest := ""
	if imageResult, inspectErr := c.api.ImageInspect(ctx, imageName); inspectErr == nil {
		localDigest = matchingRepoDigest(imageResult.RepoDigests, imageName)
	}
	remoteDigest := ""
	if distribution, inspectErr := c.api.DistributionInspect(ctx, imageName, mobyclient.DistributionInspectOptions{}); inspectErr == nil {
		remoteDigest = distribution.Descriptor.Digest.String()
	}

	switch {
	case localDigest == "" && remoteDigest == "":
		update.Error = "无法检查更新：可能是本地构建的镜像或需要登录私有仓库"
	case remoteDigest == "":
		update.Error = "无法获取远程镜像信息，请确保网络连接正常且已登录镜像仓库"
	case localDigest == "" || localDigest != remoteDigest:
		update.HasUpdate = true
	}
	return update, nil
}

func convertStats(response containertypes.StatsResponse) ContainerStats {
	var cpuDelta, systemDelta uint64
	if response.CPUStats.CPUUsage.TotalUsage > response.PreCPUStats.CPUUsage.TotalUsage {
		cpuDelta = response.CPUStats.CPUUsage.TotalUsage - response.PreCPUStats.CPUUsage.TotalUsage
	}
	if response.CPUStats.SystemUsage > response.PreCPUStats.SystemUsage {
		systemDelta = response.CPUStats.SystemUsage - response.PreCPUStats.SystemUsage
	}
	onlineCPUs := response.CPUStats.OnlineCPUs
	if onlineCPUs == 0 {
		onlineCPUs = uint32(len(response.CPUStats.CPUUsage.PercpuUsage))
	}
	cpuPercent := 0.0
	if cpuDelta > 0 && systemDelta > 0 && onlineCPUs > 0 {
		cpuPercent = float64(cpuDelta) / float64(systemDelta) * float64(onlineCPUs) * 100
	}

	memoryUsage := response.MemoryStats.Usage
	if inactiveFile := response.MemoryStats.Stats["total_inactive_file"]; inactiveFile > 0 && memoryUsage > inactiveFile {
		memoryUsage -= inactiveFile
	} else if inactiveFile := response.MemoryStats.Stats["inactive_file"]; inactiveFile > 0 && memoryUsage > inactiveFile {
		memoryUsage -= inactiveFile
	}
	memoryPercent := 0.0
	if response.MemoryStats.Limit > 0 {
		memoryPercent = float64(memoryUsage) / float64(response.MemoryStats.Limit) * 100
	}

	var networkIn, networkOut uint64
	for _, network := range response.Networks {
		networkIn += network.RxBytes
		networkOut += network.TxBytes
	}
	var blockRead, blockWrite uint64
	for _, entry := range response.BlkioStats.IoServiceBytesRecursive {
		switch strings.ToLower(entry.Op) {
		case "read":
			blockRead += entry.Value
		case "write":
			blockWrite += entry.Value
		}
	}
	if response.OSType == "windows" {
		blockRead = response.StorageStats.ReadSizeBytes
		blockWrite = response.StorageStats.WriteSizeBytes
	}

	return ContainerStats{
		ContainerID:   response.ID,
		Name:          strings.TrimPrefix(response.Name, "/"),
		CPUPercent:    cpuPercent,
		MemoryUsage:   uint64ToInt64(memoryUsage),
		MemoryLimit:   uint64ToInt64(response.MemoryStats.Limit),
		MemoryPercent: memoryPercent,
		NetworkIn:     uint64ToInt64(networkIn),
		NetworkOut:    uint64ToInt64(networkOut),
		BlockRead:     uint64ToInt64(blockRead),
		BlockWrite:    uint64ToInt64(blockWrite),
		PIDs:          uint64ToInt(response.PidsStats.Current),
	}
}

func splitRepoTag(value string) (string, string) {
	if value == "<none>:<none>" {
		return "<none>", "<none>"
	}
	named, err := reference.ParseNormalizedNamed(value)
	if err == nil {
		repository := reference.FamiliarName(reference.TrimNamed(named))
		if tagged, ok := named.(reference.Tagged); ok {
			return repository, tagged.Tag()
		}
		return repository, "latest"
	}
	return value, "latest"
}

func matchingRepoDigest(repoDigests []string, imageName string) string {
	wantedRepo := normalizedRepository(imageName)
	for _, repoDigest := range repoDigests {
		_, digest, found := strings.Cut(repoDigest, "@")
		if found && (normalizedRepository(repoDigest) == wantedRepo || len(repoDigests) == 1) {
			return digest
		}
	}
	return ""
}

func ParseTail(value string) (int, error) {
	tail, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, errors.New("tail must be a number")
	}
	if tail < 1 || tail > MaxLogTail {
		return 0, errors.New("tail must be between 1 and 5000")
	}
	return tail, nil
}

func NormalizeTail(tail int) int {
	if tail <= 0 {
		return 100
	}
	if tail > MaxLogTail {
		return MaxLogTail
	}
	return tail
}

func NormalizeContainerRef(value string) (string, error) {
	value = strings.TrimSpace(strings.TrimPrefix(value, "/"))
	if value == "" {
		return "", errors.New("container id is required")
	}
	if !ValidateContainerRef(value) {
		return "", errors.New("container id contains invalid characters")
	}
	return value, nil
}

func ValidateContainerRef(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 255 || !isRefStart(rune(value[0])) {
		return false
	}
	for _, r := range value {
		if !isRefPart(r) {
			return false
		}
	}
	return true
}

func ValidateImageRef(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 255 {
		return false
	}
	_, err := reference.ParseAnyReference(value)
	return err == nil
}

func isRefStart(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
}

func isRefPart(r rune) bool {
	if isRefStart(r) || r == '_' || r == '.' || r == '-' || r == ':' {
		return true
	}
	return false
}

func normalizedRepository(value string) string {
	named, err := reference.ParseNormalizedNamed(value)
	if err != nil {
		return ""
	}
	return reference.TrimNamed(named).Name()
}

func uint64ToInt64(value uint64) int64 {
	const maxInt64 = uint64(^uint64(0) >> 1)
	if value > maxInt64 {
		return int64(maxInt64)
	}
	return int64(value)
}

func uint64ToInt(value uint64) int {
	maxInt := uint64(^uint(0) >> 1)
	if value > maxInt {
		return int(maxInt)
	}
	return int(value)
}
