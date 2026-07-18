package monitor

import (
	"bytes"
	"fmt"
	"strings"
	"sync"
	"time"

	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	pb "github.com/easyssh/server/internal/proto"
	"github.com/easyssh/shared/monitoring"
	"google.golang.org/protobuf/proto"
)

const (
	dockerStatsRefreshInterval = 15 * time.Second
	dockerStatsRetryInterval   = 3 * time.Second
	dockerStatsCommandTimeout  = 6 * time.Second
)

// Collector 系统指标采集器
type Collector struct {
	client           *sshDomain.Client // SSH 客户端（直接使用）
	prevCPU          *monitoring.CPUStat
	prevNet          map[string]monitoring.NetStat
	prevTime         time.Time
	sshLatencyMs     int64 // SSH 命令延迟（毫秒）
	staticSystemInfo *pb.SystemInfo
	dockerMu         sync.RWMutex
	dockerStats      *pb.DockerStats
	dockerCheckedAt  time.Time
	dockerRefreshing bool
}

// NewCollector 创建采集器（使用 SSH Client）
func NewCollector(client *sshDomain.Client) *Collector {
	now := time.Now()
	return &Collector{
		client:   client,
		prevCPU:  nil,
		prevNet:  make(map[string]monitoring.NetStat),
		prevTime: now,
	}
}

// sshExec 执行 SSH 命令
func (c *Collector) sshExec(cmd string) (string, error) {
	start := time.Now()

	// 通过 SSH Client 创建新会话执行命令
	session, err := c.client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)

	// 记录 SSH 命令延迟
	c.sshLatencyMs = time.Since(start).Milliseconds()

	if err != nil {
		return "", fmt.Errorf("failed to execute command: %w", err)
	}

	return string(output), nil
}

// sshExecWithTimeout 执行可能阻塞的辅助命令，超时后主动关闭 session。
func (c *Collector) sshExecWithTimeout(cmd string, timeout time.Duration) (string, error) {
	session, err := c.client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	var output bytes.Buffer
	session.Stdout = &output
	session.Stderr = &output

	if err := session.Start(cmd); err != nil {
		return "", fmt.Errorf("failed to start command: %w", err)
	}

	done := make(chan error, 1)
	go func() {
		done <- session.Wait()
	}()

	select {
	case err := <-done:
		if err != nil {
			return output.String(), fmt.Errorf("failed to execute command: %w", err)
		}
		return output.String(), nil
	case <-time.After(timeout):
		_ = session.Close()
		return output.String(), fmt.Errorf("command timeout after %s", timeout)
	}
}

func (c *Collector) buildMetricsScript(includeStaticInfo bool) string {
	return monitoring.BuildMetricsScript(monitoring.MetricsScriptOptions{
		IncludeStaticInfo: includeStaticInfo,
	})
}

// Collect 采集所有系统指标
func (c *Collector) Collect() (*pb.SystemMetrics, error) {
	// 使用批量采集脚本减少 SSH 往返次数
	script := c.buildMetricsScript(c.staticSystemInfo == nil)

	output, err := c.sshExec(script)
	if err != nil {
		return nil, fmt.Errorf("failed to collect metrics: %w", err)
	}
	coreLatencyMs := c.sshLatencyMs

	parsed := monitoring.ParseMetricsOutput(output)

	metrics := &pb.SystemMetrics{
		Timestamp: time.Now().Unix(),
	}

	metrics.Cpu = c.buildCPUMetrics(parsed.CPU)
	metrics.Memory = buildMemoryMetrics(parsed.Memory)
	metrics.Network = c.buildNetworkMetrics(parsed.Network)
	metrics.Disks = buildDiskMetrics(parsed.Disks)
	metrics.DiskTotalPercent = c.calculateTotalDiskPercent(metrics.Disks)
	metrics.SystemInfo = c.buildSystemInfo(parsed.SystemInfo)
	metrics.Cpu.CoreCount = metrics.SystemInfo.CpuCores

	metrics.Docker = c.getDockerStats()

	// 设置核心采集 SSH 延迟。Docker 统计低频单独采集，不计入图表数据链路延迟。
	metrics.SshLatencyMs = coreLatencyMs

	return metrics, nil
}

func (c *Collector) buildCPUMetrics(curr monitoring.CPUStat) *pb.CPUMetrics {
	var usage float64
	if c.prevCPU != nil {
		usage = c.calculateCPUUsage(c.prevCPU, &curr)
	}

	c.prevCPU = &curr

	return &pb.CPUMetrics{
		UsagePercent: usage,
	}
}

// calculateCPUUsage 计算 CPU 使用率
func (c *Collector) calculateCPUUsage(prev, curr *monitoring.CPUStat) float64 {
	prevTotal := prev.Total()
	currTotal := curr.Total()

	totalDelta := monitoring.SubtractUint64(currTotal, prevTotal)
	idleDelta := monitoring.SubtractUint64(curr.IdleTotal(), prev.IdleTotal())

	if totalDelta == 0 {
		return 0.0
	}

	return (1.0 - float64(idleDelta)/float64(totalDelta)) * 100.0
}

func buildMemoryMetrics(memory monitoring.MemoryMetrics) *pb.MemoryMetrics {
	return &pb.MemoryMetrics{
		RamUsedBytes:   memory.RAMUsedBytes,
		RamTotalBytes:  memory.RAMTotalBytes,
		SwapUsedBytes:  memory.SwapUsedBytes,
		SwapTotalBytes: memory.SwapTotalBytes,
	}
}

func (c *Collector) buildNetworkMetrics(network monitoring.NetworkMetrics) *pb.NetworkMetrics {
	// 计算总速率
	var totalRx, totalTx uint64
	now := time.Now()

	if len(c.prevNet) > 0 {
		duration := now.Sub(c.prevTime).Seconds()

		for iface, curr := range network.Interfaces {
			if prev, ok := c.prevNet[iface]; ok && duration > 0 {
				rxDelta := monitoring.SubtractUint64(curr.RxBytes, prev.RxBytes)
				txDelta := monitoring.SubtractUint64(curr.TxBytes, prev.TxBytes)

				totalRx += uint64(float64(rxDelta) / duration)
				totalTx += uint64(float64(txDelta) / duration)
			}
		}
	}

	c.prevNet = network.Interfaces
	c.prevTime = now

	return &pb.NetworkMetrics{
		BytesRecvPerSec: totalRx,
		BytesSentPerSec: totalTx,
	}
}

func buildDiskMetrics(disks []monitoring.DiskMetrics) []*pb.DiskMetrics {
	pbDisks := make([]*pb.DiskMetrics, 0, len(disks))
	for _, disk := range disks {
		pbDisks = append(pbDisks, &pb.DiskMetrics{
			MountPoint: disk.MountPoint,
			TotalBytes: disk.TotalBytes,
			UsedBytes:  disk.UsedBytes,
		})
	}
	return pbDisks
}

func (c *Collector) buildSystemInfo(info monitoring.SystemInfo) *pb.SystemInfo {
	if info.OS != "" || info.Hostname != "" || info.CPUModel != "" || info.Arch != "" || info.CPUCores > 0 {
		c.staticSystemInfo = &pb.SystemInfo{
			Os:       info.OS,
			Hostname: info.Hostname,
			CpuModel: info.CPUModel,
			Arch:     info.Arch,
			CpuCores: info.CPUCores,
		}
	}

	staticInfo := c.staticSystemInfo
	if staticInfo == nil {
		staticInfo = &pb.SystemInfo{}
	}

	return &pb.SystemInfo{
		Os:            staticInfo.Os,
		Hostname:      staticInfo.Hostname,
		CpuModel:      staticInfo.CpuModel,
		Arch:          staticInfo.Arch,
		LoadAvg:       info.LoadAvg,
		UptimeSeconds: info.UptimeSeconds,
		CpuCores:      staticInfo.CpuCores,
	}
}

// calculateTotalDiskPercent 计算磁盘总使用率
func (c *Collector) calculateTotalDiskPercent(disks []*pb.DiskMetrics) float64 {
	if len(disks) == 0 {
		return 0.0
	}

	var totalUsed, totalSize uint64
	for _, disk := range disks {
		totalUsed += disk.UsedBytes
		totalSize += disk.TotalBytes
	}

	if totalSize == 0 {
		return 0.0
	}

	return (float64(totalUsed) / float64(totalSize)) * 100.0
}

func (c *Collector) getDockerStats() *pb.DockerStats {
	now := time.Now()

	c.dockerMu.RLock()
	stats := cloneDockerStats(c.dockerStats)
	checkedAt := c.dockerCheckedAt
	c.dockerMu.RUnlock()

	refreshInterval := dockerStatsRefreshInterval
	if stats == nil {
		refreshInterval = dockerStatsRetryInterval
	}

	needsRefresh := checkedAt.IsZero() || now.Sub(checkedAt) >= refreshInterval
	if needsRefresh {
		c.startDockerStatsRefresh()
	}

	return stats
}

func (c *Collector) startDockerStatsRefresh() {
	c.dockerMu.Lock()
	if c.dockerRefreshing {
		c.dockerMu.Unlock()
		return
	}
	c.dockerRefreshing = true
	c.dockerMu.Unlock()

	go func() {
		stats, err := c.collectDockerStats()

		c.dockerMu.Lock()
		defer c.dockerMu.Unlock()
		c.dockerRefreshing = false
		c.dockerCheckedAt = time.Now()
		if err != nil {
			return
		}
		c.dockerStats = stats
	}()
}

func cloneDockerStats(stats *pb.DockerStats) *pb.DockerStats {
	if stats == nil {
		return nil
	}

	return proto.Clone(stats).(*pb.DockerStats)
}

func (c *Collector) collectDockerStats() (*pb.DockerStats, error) {
	output, err := c.sshExecWithTimeout(monitoring.BuildDockerStatsScript(), dockerStatsCommandTimeout)
	output = strings.TrimSpace(output)
	if err != nil && output == "" {
		return nil, err
	}

	lines := strings.Split(output, "\n")
	if len(lines) < 3 {
		return nil, fmt.Errorf("invalid docker stats output: %q", output)
	}

	status := strings.TrimSpace(lines[0])
	if status != "installed" && status != "not_installed" {
		return nil, fmt.Errorf("invalid docker stats status: %q", status)
	}

	stats := monitoring.ParseDockerStatsOutput(output)
	return &pb.DockerStats{
		DockerInstalled:   stats.DockerInstalled,
		ContainersRunning: stats.ContainersRunning,
		ContainersTotal:   stats.ContainersTotal,
	}, nil
}
