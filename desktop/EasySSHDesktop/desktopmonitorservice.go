package main

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const desktopMonitorCollectCommand = `
set +e

if [ -r /etc/os-release ]; then
  OS_NAME=$(awk -F= '/^PRETTY_NAME=/{gsub(/^"|"$/, "", $2); print $2; exit}' /etc/os-release)
fi
[ -n "$OS_NAME" ] || OS_NAME=$(uname -s 2>/dev/null)
HOSTNAME_VALUE=$(hostname 2>/dev/null || uname -n 2>/dev/null)
ARCH_VALUE=$(uname -m 2>/dev/null)
CPU_MODEL=$(awk -F': ' '/model name|Hardware|Processor/{print $2; exit}' /proc/cpuinfo 2>/dev/null)
[ -n "$CPU_MODEL" ] || CPU_MODEL=$(uname -p 2>/dev/null)
CPU_CORES=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 0)
LOAD_AVG=$(awk '{print $1" "$2" "$3}' /proc/loadavg 2>/dev/null)
UPTIME_SECONDS=$(awk '{printf "%d", $1}' /proc/uptime 2>/dev/null)

CPU_LINE=$(awk 'NR==1 {idle=$5+$6; total=0; for (i=2; i<=NF; i++) total += $i; printf "%s %s", idle, total}' /proc/stat 2>/dev/null)
CPU_IDLE=$(printf '%s' "$CPU_LINE" | awk '{print $1}')
CPU_TOTAL=$(printf '%s' "$CPU_LINE" | awk '{print $2}')

MEM_LINE=$(awk '
  /MemTotal:/ {total=$2*1024}
  /MemAvailable:/ {available=$2*1024}
  /MemFree:/ {free=$2*1024}
  /SwapTotal:/ {swapTotal=$2*1024}
  /SwapFree:/ {swapFree=$2*1024}
  END {
    if (!available) available=free
    used=total-available
    swapUsed=swapTotal-swapFree
    printf "%s %s %s %s", used, total, swapUsed, swapTotal
  }
' /proc/meminfo 2>/dev/null)
RAM_USED=$(printf '%s' "$MEM_LINE" | awk '{print $1}')
RAM_TOTAL=$(printf '%s' "$MEM_LINE" | awk '{print $2}')
SWAP_USED=$(printf '%s' "$MEM_LINE" | awk '{print $3}')
SWAP_TOTAL=$(printf '%s' "$MEM_LINE" | awk '{print $4}')

NET_LINE=$(awk '
  NR>2 {
    gsub(":", "", $1)
    if ($1 != "lo") {
      rx += $2
      tx += $10
    }
  }
  END {printf "%s %s", rx, tx}
' /proc/net/dev 2>/dev/null)
NET_RX=$(printf '%s' "$NET_LINE" | awk '{print $1}')
NET_TX=$(printf '%s' "$NET_LINE" | awk '{print $2}')

DOCKER_INSTALLED=0
DOCKER_RUNNING=0
DOCKER_TOTAL=0
if command -v docker >/dev/null 2>&1; then
  DOCKER_INSTALLED=1
  DOCKER_RUNNING=$(docker ps -q 2>/dev/null | wc -l | awk '{print $1}')
  DOCKER_TOTAL=$(docker ps -aq 2>/dev/null | wc -l | awk '{print $1}')
fi

printf 'OS=%s\n' "$OS_NAME"
printf 'HOSTNAME=%s\n' "$HOSTNAME_VALUE"
printf 'ARCH=%s\n' "$ARCH_VALUE"
printf 'CPU_MODEL=%s\n' "$CPU_MODEL"
printf 'CPU_CORES=%s\n' "$CPU_CORES"
printf 'LOAD_AVG=%s\n' "$LOAD_AVG"
printf 'UPTIME_SECONDS=%s\n' "$UPTIME_SECONDS"
printf 'CPU_IDLE=%s\n' "$CPU_IDLE"
printf 'CPU_TOTAL=%s\n' "$CPU_TOTAL"
printf 'RAM_USED=%s\n' "$RAM_USED"
printf 'RAM_TOTAL=%s\n' "$RAM_TOTAL"
printf 'SWAP_USED=%s\n' "$SWAP_USED"
printf 'SWAP_TOTAL=%s\n' "$SWAP_TOTAL"
printf 'NET_RX=%s\n' "$NET_RX"
printf 'NET_TX=%s\n' "$NET_TX"
printf 'DOCKER_INSTALLED=%s\n' "$DOCKER_INSTALLED"
printf 'DOCKER_RUNNING=%s\n' "$DOCKER_RUNNING"
printf 'DOCKER_TOTAL=%s\n' "$DOCKER_TOTAL"

df -P -k 2>/dev/null | awk '
  NR>1 && $2 > 0 && $1 !~ /^(tmpfs|devtmpfs|squashfs)$/ {
    printf "DISK|%s|%s|%s\n", $6, $3 * 1024, $2 * 1024
  }
'
`

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

	result, err := s.serverService.ExecuteCommand(DesktopServerCommandInput{
		ServerID:  serverID,
		Command:   desktopMonitorCollectCommand,
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
	if snapshot.Disks == nil {
		snapshot.Disks = []DesktopMonitorDiskInfo{}
	}
	if err := s.serverService.UpdateOSIfEmpty(serverID, snapshot.SystemInfo.OS); err != nil {
		fmt.Printf("failed to update desktop server OS from monitor: %v\n", err)
	}

	return snapshot, nil
}

func parseDesktopMonitorSnapshot(output string) (DesktopMonitorSnapshot, error) {
	values := map[string]string{}
	disks := []DesktopMonitorDiskInfo{}

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "DISK|") {
			disk, ok := parseDesktopMonitorDisk(line)
			if ok {
				disks = append(disks, disk)
			}
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}

	snapshot := DesktopMonitorSnapshot{
		SystemInfo: DesktopMonitorSystemInfo{
			OS:            values["OS"],
			Hostname:      values["HOSTNAME"],
			CPUModel:      values["CPU_MODEL"],
			Arch:          values["ARCH"],
			LoadAvg:       values["LOAD_AVG"],
			UptimeSeconds: parseDesktopMonitorInt64(values["UPTIME_SECONDS"]),
			CPUCores:      parseDesktopMonitorInt(values["CPU_CORES"]),
		},
		CPU: DesktopMonitorCPUInfo{
			IdleTicks:  parseDesktopMonitorUint64(values["CPU_IDLE"]),
			TotalTicks: parseDesktopMonitorUint64(values["CPU_TOTAL"]),
			CoreCount:  parseDesktopMonitorInt(values["CPU_CORES"]),
		},
		Memory: DesktopMonitorMemoryInfo{
			RAMUsedBytes:   parseDesktopMonitorUint64(values["RAM_USED"]),
			RAMTotalBytes:  parseDesktopMonitorUint64(values["RAM_TOTAL"]),
			SwapUsedBytes:  parseDesktopMonitorUint64(values["SWAP_USED"]),
			SwapTotalBytes: parseDesktopMonitorUint64(values["SWAP_TOTAL"]),
		},
		Network: DesktopMonitorNetworkInfo{
			BytesRecvTotal: parseDesktopMonitorUint64(values["NET_RX"]),
			BytesSentTotal: parseDesktopMonitorUint64(values["NET_TX"]),
		},
		Disks: disks,
		Docker: DesktopMonitorDockerInfo{
			ContainersRunning: parseDesktopMonitorInt(values["DOCKER_RUNNING"]),
			ContainersTotal:   parseDesktopMonitorInt(values["DOCKER_TOTAL"]),
			DockerInstalled:   parseDesktopMonitorBool(values["DOCKER_INSTALLED"]),
		},
	}

	return snapshot, nil
}

func parseDesktopMonitorDisk(line string) (DesktopMonitorDiskInfo, bool) {
	parts := strings.Split(line, "|")
	if len(parts) != 4 {
		return DesktopMonitorDiskInfo{}, false
	}

	mountPoint := strings.TrimSpace(parts[1])
	if mountPoint == "" {
		return DesktopMonitorDiskInfo{}, false
	}

	return DesktopMonitorDiskInfo{
		MountPoint: mountPoint,
		UsedBytes:  parseDesktopMonitorUint64(parts[2]),
		TotalBytes: parseDesktopMonitorUint64(parts[3]),
	}, true
}

func parseDesktopMonitorUint64(value string) uint64 {
	parsed, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func parseDesktopMonitorInt64(value string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func parseDesktopMonitorInt(value string) int {
	parsed := parseDesktopMonitorInt64(value)
	if parsed < 0 {
		return 0
	}
	return int(parsed)
}

func parseDesktopMonitorBool(value string) bool {
	value = strings.TrimSpace(strings.ToLower(value))
	return value == "1" || value == "true" || value == "yes"
}
