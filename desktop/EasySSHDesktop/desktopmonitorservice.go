package main

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyssh/shared/monitoring"
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
	collectedAt time.Time
}

type DesktopMonitorService struct {
	serverService *DesktopServerService
}

func NewDesktopMonitorService(serverService *DesktopServerService) *DesktopMonitorService {
	return &DesktopMonitorService{serverService: serverService}
}

func (s *DesktopMonitorService) Collect(input DesktopMonitorCollectInput) (DesktopMonitorSnapshot, error) {
	serverID := strings.TrimSpace(input.ServerID)
	if serverID == "" {
		return DesktopMonitorSnapshot{}, errors.New("server id is required")
	}

	timeoutMs := input.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 15000
	}
	if timeoutMs > 30000 {
		timeoutMs = 30000
	}

	command := monitoring.BuildMetricsScript(monitoring.MetricsScriptOptions{
		IncludeStaticInfo:  true,
		IncludeDockerStats: true,
	})
	result, err := s.serverService.ExecuteCommand(DesktopServerCommandInput{
		ServerID:  serverID,
		Command:   command,
		TimeoutMs: timeoutMs,
	})
	if err != nil {
		return DesktopMonitorSnapshot{}, err
	}
	if result.ExitCode != 0 {
		message := strings.TrimSpace(result.Output)
		if message == "" {
			message = fmt.Sprintf("monitor command failed with exit code %d", result.ExitCode)
		}
		return DesktopMonitorSnapshot{}, errors.New(message)
	}

	snapshot, err := parseDesktopMonitorSnapshot(result.Output)
	if err != nil {
		return DesktopMonitorSnapshot{}, err
	}

	completedAt := time.Now().UTC()
	snapshot.SSHLatency = result.DurationMs
	snapshot.Timestamp = completedAt.Unix()
	snapshot.CollectedAt = completedAt.Format(time.RFC3339Nano)
	snapshot.collectedAt = completedAt
	if snapshot.Disks == nil {
		snapshot.Disks = []DesktopMonitorDiskInfo{}
	}
	if err := s.serverService.updateOSIfEmpty(serverID, snapshot.SystemInfo.OS); err != nil {
		desktopLogPrintf("failed to update desktop server OS from monitor: %v", err)
	}

	return snapshot, nil
}

func parseDesktopMonitorSnapshot(output string) (DesktopMonitorSnapshot, error) {
	metrics := monitoring.ParseMetricsOutput(output)

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
			IdleTicks:  metrics.CPU.IdleTotal(),
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
	}, nil
}
