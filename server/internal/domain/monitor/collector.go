package monitor

import (
	"context"
	"fmt"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"strings"
	"sync"
	"time"

	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/shared/monitoring"
	pb "github.com/easyssh/shared/monitorwire"
	"google.golang.org/protobuf/proto"
)

const (
	dockerStatsRefreshInterval = 15 * time.Second
	dockerStatsRetryInterval   = 3 * time.Second
	dockerStatsCommandTimeout  = 6 * time.Second
)

// Collector 系统指标采集器
type Collector struct {
	ctx              context.Context
	cancel           context.CancelFunc
	serverID         string
	client           *sshDomain.Client // SSH 客户端（直接使用）
	sampler          monitoring.Sampler
	sshLatencyMs     int64 // SSH 命令延迟（毫秒）
	staticSystemInfo *pb.SystemInfo
	dockerMu         sync.RWMutex
	dockerStats      *pb.DockerStats
	dockerCheckedAt  time.Time
	dockerRefreshing bool
}

// NewCollector 创建采集器（使用 SSH Client）
func NewCollector(ctx context.Context, serverID string, client *sshDomain.Client) *Collector {
	ctx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	return &Collector{ctx: ctx, cancel: cancel, serverID: serverID, client: client}
}

func (c *Collector) Close() { c.cancel() }

func (c *Collector) execute(cmd string, timeout time.Duration, action protocol.Action) (string, error) {
	ctx, cancel := context.WithTimeout(c.ctx, timeout)
	defer cancel()
	lease, err := access.Current(ctx).OpenWork(ctx, access.Task, access.Requirement{Action: action, ServerID: c.serverID})
	if err != nil {
		return "", err
	}
	defer lease.Close(nil)
	result, err := c.client.ExecuteCommandDetailedContext(lease.Context(), cmd)
	if result == nil {
		return "", err
	}
	return result.Output, err
}
func (c *Collector) sshExec(cmd string) (string, error) {
	start := time.Now()
	output, err := c.execute(cmd, 15*time.Second, protocol.MonitorRead)
	c.sshLatencyMs = time.Since(start).Milliseconds()
	return output, err
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
	now := time.Now()

	metrics := c.sampler.Sample(parsed, now)
	metrics.Timestamp = now.Unix()
	metrics.SystemInfo = c.buildSystemInfo(parsed.SystemInfo)
	metrics.Cpu.CoreCount = metrics.SystemInfo.CpuCores

	if access.Current(c.ctx).Check(c.ctx, access.Requirement{Action: protocol.DockerRead, ServerID: c.serverID}) == nil {
		metrics.Docker = c.getDockerStats()
	}

	// 设置核心采集 SSH 延迟。Docker 统计低频单独采集，不计入图表数据链路延迟。
	metrics.SshLatencyMs = coreLatencyMs

	return metrics, nil
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
	output, err := c.execute(monitoring.BuildDockerStatsScript(), dockerStatsCommandTimeout, protocol.DockerRead)
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
