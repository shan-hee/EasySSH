package monitoring

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/server"
	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/server/internal/pkg/crypto"
	sharedmonitoring "github.com/easyssh/shared/monitoring"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

// EasySSHDataSource EasySSH 数据源（SSH 直连采集）
type EasySSHDataSource struct {
	serverService   server.Service
	encryptor       *crypto.Encryptor
	userID          uuid.UUID
	hostKeyCallback ssh.HostKeyCallback
}

// NewEasySSHDataSource 创建 EasySSH 数据源
func NewEasySSHDataSource(serverService server.Service, encryptor *crypto.Encryptor, userID uuid.UUID, hostKeyCallback ssh.HostKeyCallback) *EasySSHDataSource {
	return &EasySSHDataSource{
		serverService:   serverService,
		encryptor:       encryptor,
		userID:          userID,
		hostKeyCallback: hostKeyCallback,
	}
}

// Name 返回数据源名称
func (e *EasySSHDataSource) Name() string {
	return "easyssh"
}

// TestConnection 测试连接（对于 EasySSH，始终返回成功）
func (e *EasySSHDataSource) TestConnection(ctx context.Context) error {
	return nil
}

// GetServersResources 获取所有服务器资源概览
func (e *EasySSHDataSource) GetServersResources(ctx context.Context) ([]*ServerResourceSummary, error) {
	// 获取用户的所有服务器
	servers, _, err := e.serverService.List(ctx, e.userID, 1000, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to list servers: %w", err)
	}

	// 并行采集所有服务器的资源
	var wg sync.WaitGroup
	results := make([]*ServerResourceSummary, len(servers))

	for i, srv := range servers {
		wg.Add(1)
		go func(index int, srv *server.Server) {
			defer wg.Done()
			results[index] = e.collectServerResource(ctx, srv)
		}(i, srv)
	}

	wg.Wait()
	return results, nil
}

// StreamServersResources 流式获取服务器资源
func (e *EasySSHDataSource) StreamServersResources(ctx context.Context, resultChan chan<- *ServerResourceSummary) error {
	// 获取用户的所有服务器
	servers, _, err := e.serverService.List(ctx, e.userID, 1000, 0)
	if err != nil {
		return fmt.Errorf("failed to list servers: %w", err)
	}

	// 并行采集所有服务器的资源，每台完成后立即发送
	var wg sync.WaitGroup

	for _, srv := range servers {
		wg.Add(1)
		go func(srv *server.Server) {
			defer wg.Done()
			result := e.collectServerResource(ctx, srv)
			select {
			case resultChan <- result:
			case <-ctx.Done():
				return
			}
		}(srv)
	}

	wg.Wait()
	return nil
}

// collectServerResource 采集单台服务器的资源（单次SSH连接）
func (e *EasySSHDataSource) collectServerResource(ctx context.Context, srv *server.Server) *ServerResourceSummary {
	result := &ServerResourceSummary{
		ServerID:    srv.ID.String(),
		Name:        srv.Name,
		Host:        srv.Host,
		Port:        srv.Port,
		Status:      "offline",
		CollectedAt: time.Now(),
	}

	// 从 Server 表读取地理位置信息
	if srv.Country != "" || srv.Region != "" || srv.City != "" {
		result.Location = &LocationSummary{
			Country:     srv.Country,
			CountryCode: srv.CountryCode,
			Region:      srv.Region,
			City:        srv.City,
		}
	}

	// 如果服务器不是 online 状态，直接返回
	if srv.Status != "online" {
		return result
	}

	// 创建 SSH 客户端
	sshClient, err := sshDomain.NewClient(srv, e.encryptor, e.hostKeyCallback)
	if err != nil {
		result.Status = "error"
		result.Error = fmt.Sprintf("failed to create SSH client: %v", err)
		return result
	}

	// 连接（设置超时）
	connCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	connDone := make(chan error, 1)
	go func() {
		connDone <- sshClient.Connect(srv.Host, srv.Port)
	}()

	select {
	case err = <-connDone:
		if err != nil {
			result.Status = "error"
			result.Error = fmt.Sprintf("failed to connect: %v", err)
			return result
		}
	case <-connCtx.Done():
		result.Status = "error"
		result.Error = "connection timeout"
		return result
	}
	defer sshClient.Close()

	// 执行批量采集脚本
	output, err := sshClient.ExecuteCommand(sharedmonitoring.BuildMetricsScript(sharedmonitoring.MetricsScriptOptions{
		IncludeStaticInfo: true,
	}))
	if err != nil {
		result.Status = "error"
		result.Error = fmt.Sprintf("failed to execute command: %v", err)
		return result
	}

	// 解析输出
	e.parseBatchOutput(output, result)
	result.Status = "online"

	return result
}

func (e *EasySSHDataSource) parseBatchOutput(output string, result *ServerResourceSummary) {
	metrics := sharedmonitoring.ParseMetricsOutput(output)

	result.CPU = &CPUSummary{
		Cores:        int(metrics.SystemInfo.CPUCores),
		UsagePercent: calculateCPUPercent(metrics.CPU),
		LoadAverage:  parseLoadAverage(metrics.SystemInfo.LoadAvg),
	}
	result.Memory = &MemorySummary{
		Total:       metrics.Memory.RAMTotalBytes,
		Used:        metrics.Memory.RAMUsedBytes,
		UsedPercent: calculatePercent(metrics.Memory.RAMUsedBytes, metrics.Memory.RAMTotalBytes),
	}
	result.Disk = summarizeDisks(metrics.Disks)
	result.Network = &NetworkSummary{
		RxBytes: metrics.Network.BytesRecvTotal,
		TxBytes: metrics.Network.BytesSentTotal,
	}
	result.Uptime = metrics.SystemInfo.UptimeSeconds
}

func calculateCPUPercent(cpu sharedmonitoring.CPUStat) float64 {
	total := cpu.Total()
	if total == 0 {
		return 0
	}
	idle := cpu.IdleTotal()
	if idle > total {
		return 0
	}
	return float64(total-idle) / float64(total) * 100
}

func calculatePercent(used uint64, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

func parseLoadAverage(value string) []float64 {
	parts := strings.Split(value, ",")
	result := make([]float64, 0, len(parts))
	for _, part := range parts {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err == nil {
			result = append(result, parsed)
		}
	}
	return result
}

func summarizeDisks(disks []sharedmonitoring.DiskMetrics) *DiskSummary {
	summary := &DiskSummary{}
	for _, disk := range disks {
		summary.Total += disk.TotalBytes
		summary.Used += disk.UsedBytes
	}
	summary.UsedPercent = calculatePercent(summary.Used, summary.Total)
	return summary
}
