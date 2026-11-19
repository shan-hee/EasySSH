package app

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/monitoring"
	"github.com/easyssh/shared/sshutil"
)

type DesktopMonitorCollectInput struct {
	ServerID  string `json:"serverId"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
}

type DesktopMonitorSystemInfo struct {
	OS            string `json:"os"`
	Hostname      string `json:"hostname"`
	CPUModel      string `json:"cpuModel"`
	Arch          string `json:"arch"`
	LoadAvg       string `json:"loadAvg"`
	UptimeSeconds int64  `json:"uptimeSeconds"`
	CPUCores      int    `json:"cpuCores"`
}

type DesktopMonitorCPUInfo struct {
	IdleTicks    uint64  `json:"idleTicks"`
	TotalTicks   uint64  `json:"totalTicks"`
	CoreCount    int     `json:"coreCount"`
	UsagePercent float64 `json:"usagePercent"`
}

type DesktopMonitorMemoryInfo struct {
	RAMUsedBytes   uint64 `json:"ramUsedBytes"`
	RAMTotalBytes  uint64 `json:"ramTotalBytes"`
	SwapUsedBytes  uint64 `json:"swapUsedBytes"`
	SwapTotalBytes uint64 `json:"swapTotalBytes"`
}

type DesktopMonitorNetworkInfo struct {
	BytesRecvTotal uint64 `json:"bytesRecvTotal"`
	BytesSentTotal uint64 `json:"bytesSentTotal"`
}

type DesktopMonitorDiskInfo struct {
	MountPoint string `json:"mountPoint"`
	UsedBytes  uint64 `json:"usedBytes"`
	TotalBytes uint64 `json:"totalBytes"`
}

type DesktopMonitorDockerInfo struct {
	ContainersRunning int  `json:"containersRunning"`
	ContainersTotal   int  `json:"containersTotal"`
	DockerInstalled   bool `json:"dockerInstalled"`
}

type DesktopMonitorSnapshot struct {
	SystemInfo  DesktopMonitorSystemInfo  `json:"systemInfo"`
	CPU         DesktopMonitorCPUInfo     `json:"cpu"`
	Memory      DesktopMonitorMemoryInfo  `json:"memory"`
	Network     DesktopMonitorNetworkInfo `json:"network"`
	Disks       []DesktopMonitorDiskInfo  `json:"disks"`
	Docker      DesktopMonitorDockerInfo  `json:"docker"`
	SSHLatency  int64                     `json:"sshLatencyMs"`
	Timestamp   int64                     `json:"timestamp"`
	CollectedAt string                    `json:"collectedAt"`
}

// desktopMonitorSample 是一次采集的原始结果；网关用它配合 monitoring.Sampler 计算速率。
type desktopMonitorSample struct {
	metrics     monitoring.MetricsSnapshot
	latencyMs   int64
	collectedAt time.Time
}

type DesktopMonitorService struct {
	desktopOperationRegistry
	serverService *DesktopServerService
	activity      *ActivityLogService
	connections   map[string]*desktopMonitorConnection
}

func NewDesktopMonitorService(serverService *DesktopServerService, activity *ActivityLogService) *DesktopMonitorService {
	return &DesktopMonitorService{serverService: serverService, activity: activity}
}

func (s *DesktopMonitorService) Collect(input DesktopMonitorCollectInput) (DesktopMonitorSnapshot, error) {
	return s.CollectContext(context.Background(), input)
}

func (s *DesktopMonitorService) CollectContext(ctx context.Context, input DesktopMonitorCollectInput) (DesktopMonitorSnapshot, error) {
	sample, err := s.collect(ctx, input)
	if err != nil {
		return DesktopMonitorSnapshot{}, err
	}
	return newDesktopMonitorSnapshot(sample), nil
}

func (s *DesktopMonitorService) collect(ctx context.Context, input DesktopMonitorCollectInput) (desktopMonitorSample, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	serverID := strings.TrimSpace(input.ServerID)
	if serverID == "" {
		return desktopMonitorSample{}, errors.New("server id is required")
	}

	timeoutMs := input.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 15000
	}
	if timeoutMs > 30000 {
		timeoutMs = 30000
	}

	ctx, finish, err := s.beginOperation(ctx)
	if err != nil {
		return desktopMonitorSample{}, err
	}
	defer finish()
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	server, err := s.serverService.getByIDRaw(serverID)
	if err != nil {
		return desktopMonitorSample{}, err
	}
	client, release, err := s.acquireConnection(ctx, server)
	if err != nil {
		return desktopMonitorSample{}, err
	}
	defer release()
	command := monitoring.BuildMetricsScript(monitoring.MetricsScriptOptions{
		IncludeStaticInfo:  true,
		IncludeDockerStats: true,
	})
	started := time.Now()
	output, err := sshutil.CommandOutput(ctx, client, command, 128<<10)
	if err != nil {
		return desktopMonitorSample{}, err
	}
	sample := desktopMonitorSample{
		metrics:     monitoring.ParseMetricsOutput(string(output)),
		latencyMs:   time.Since(started).Milliseconds(),
		collectedAt: time.Now().UTC(),
	}
	if err := s.serverService.updateOSIfEmpty(serverID, sample.metrics.SystemInfo.OS); err != nil {
		desktopLogPrintf("failed to update desktop server OS from monitor: %v", err)
	}

	return sample, nil
}

func newDesktopMonitorSnapshot(sample desktopMonitorSample) DesktopMonitorSnapshot {
	metrics := sample.metrics

	disks := make([]DesktopMonitorDiskInfo, 0, len(metrics.Disks))
	for _, disk := range metrics.Disks {
		disks = append(disks, DesktopMonitorDiskInfo{
			MountPoint: disk.MountPoint,
			UsedBytes:  disk.UsedBytes,
			TotalBytes: disk.TotalBytes,
		})
	}

	return DesktopMonitorSnapshot{
		SystemInfo: DesktopMonitorSystemInfo{
			OS:            metrics.SystemInfo.OS,
			Hostname:      metrics.SystemInfo.Hostname,
			CPUModel:      metrics.SystemInfo.CPUModel,
			Arch:          metrics.SystemInfo.Arch,
			LoadAvg:       metrics.SystemInfo.LoadAvg,
			UptimeSeconds: int64(metrics.SystemInfo.UptimeSeconds),
			CPUCores:      int(metrics.SystemInfo.CPUCores),
		},
		CPU: DesktopMonitorCPUInfo{
			// 与 monitoring.Sampler 一致：使用率 = 100 - idle，iowait 计入使用。
			IdleTicks:  metrics.CPU.Idle,
			TotalTicks: metrics.CPU.Total(),
			CoreCount:  int(metrics.SystemInfo.CPUCores),
		},
		Memory: DesktopMonitorMemoryInfo{
			RAMUsedBytes:   metrics.Memory.RAMUsedBytes,
			RAMTotalBytes:  metrics.Memory.RAMTotalBytes,
			SwapUsedBytes:  metrics.Memory.SwapUsedBytes,
			SwapTotalBytes: metrics.Memory.SwapTotalBytes,
		},
		Network: DesktopMonitorNetworkInfo{
			BytesRecvTotal: metrics.Network.BytesRecvTotal,
			BytesSentTotal: metrics.Network.BytesSentTotal,
		},
		Disks: disks,
		Docker: DesktopMonitorDockerInfo{
			ContainersRunning: int(metrics.Docker.ContainersRunning),
			ContainersTotal:   int(metrics.Docker.ContainersTotal),
			DockerInstalled:   metrics.Docker.DockerInstalled,
		},
		SSHLatency:  sample.latencyMs,
		Timestamp:   sample.collectedAt.Unix(),
		CollectedAt: sample.collectedAt.Format(time.RFC3339Nano),
	}
}
