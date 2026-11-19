package monitoring

import (
	"sort"
	"time"

	"github.com/easyssh/shared/monitorwire"
)

// Sampler 把相邻两次快照换算成速率类指标（CPU 使用率、网卡速率）。
// Web 服务端和桌面网关共用它，每条监控流各持有一个实例。
type Sampler struct {
	previous   *MetricsSnapshot
	previousAt time.Time
}

// Sample 返回 CPU、内存、网络、磁盘指标；系统信息、时间戳、延迟和 Docker 由调用方填充。
// 第一次采样没有基线，速率类字段为 0。
func (s *Sampler) Sample(snapshot MetricsSnapshot, at time.Time) *monitorwire.SystemMetrics {
	metrics := &monitorwire.SystemMetrics{
		Cpu: &monitorwire.CPUMetrics{},
		Memory: &monitorwire.MemoryMetrics{
			RamUsedBytes:   snapshot.Memory.RAMUsedBytes,
			RamTotalBytes:  snapshot.Memory.RAMTotalBytes,
			RamCacheBytes:  snapshot.Memory.RAMCacheBytes,
			SwapUsedBytes:  snapshot.Memory.SwapUsedBytes,
			SwapTotalBytes: snapshot.Memory.SwapTotalBytes,
		},
		Network: &monitorwire.NetworkMetrics{DefaultInterface: snapshot.Network.DefaultInterface},
	}

	var usedBytes, totalBytes uint64
	for _, disk := range snapshot.Disks {
		usedBytes += disk.UsedBytes
		totalBytes += disk.TotalBytes
		metrics.Disks = append(metrics.Disks, &monitorwire.DiskMetrics{
			MountPoint:  disk.MountPoint,
			UsedBytes:   disk.UsedBytes,
			TotalBytes:  disk.TotalBytes,
			Device:      disk.Device,
			FsType:      disk.FSType,
			InodesUsed:  disk.InodesUsed,
			InodesTotal: disk.InodesTotal,
		})
	}
	if totalBytes > 0 {
		metrics.DiskTotalPercent = float64(usedBytes) / float64(totalBytes) * 100
	}

	var elapsed float64
	if s.previous != nil {
		elapsed = at.Sub(s.previousAt).Seconds()
	}
	if elapsed > 0 {
		prev := s.previous
		cpu := cpuShares(prev.CPU, snapshot.CPU)
		metrics.Cpu.UsagePercent = cpu.usage
		metrics.Cpu.IowaitPercent = cpu.iowait
		metrics.Cpu.StealPercent = cpu.steal
		if len(prev.CPUCores) == len(snapshot.CPUCores) {
			for i, core := range snapshot.CPUCores {
				metrics.Cpu.CoreUsagePercent = append(metrics.Cpu.CoreUsagePercent, cpuShares(prev.CPUCores[i], core).usage)
			}
		}
	}

	for name, curr := range snapshot.Network.Interfaces {
		iface := &monitorwire.NetworkInterfaceMetrics{Name: name}
		if prev, ok := s.previousInterface(name); ok && elapsed > 0 {
			iface.BytesRecvPerSec = uint64(float64(SubtractUint64(curr.RxBytes, prev.RxBytes)) / elapsed)
			iface.BytesSentPerSec = uint64(float64(SubtractUint64(curr.TxBytes, prev.TxBytes)) / elapsed)
		}
		metrics.Network.BytesRecvPerSec += iface.BytesRecvPerSec
		metrics.Network.BytesSentPerSec += iface.BytesSentPerSec
		metrics.Network.Interfaces = append(metrics.Network.Interfaces, iface)
	}
	defaultIface := snapshot.Network.DefaultInterface
	sort.Slice(metrics.Network.Interfaces, func(i, j int) bool {
		a, b := metrics.Network.Interfaces[i].Name, metrics.Network.Interfaces[j].Name
		if a == defaultIface || b == defaultIface {
			return a == defaultIface
		}
		return a < b
	})

	s.previous = &snapshot
	s.previousAt = at
	return metrics
}

func (s *Sampler) previousInterface(name string) (NetStat, bool) {
	if s.previous == nil {
		return NetStat{}, false
	}
	stat, ok := s.previous.Network.Interfaces[name]
	return stat, ok
}

type cpuShare struct {
	usage  float64
	iowait float64
	steal  float64
}

// cpuShares 计算两次累计节拍之间的占比。usage = 100 - idle，包含 iowait 与 steal，
// 前端据此把面积图分为"使用"(usage - iowait - steal) 和"等待"(iowait + steal) 两层。
func cpuShares(prev, curr CPUStat) cpuShare {
	total := float64(SubtractUint64(curr.Total(), prev.Total()))
	if total == 0 {
		return cpuShare{}
	}
	percent := func(currValue, prevValue uint64) float64 {
		return float64(SubtractUint64(currValue, prevValue)) / total * 100
	}
	return cpuShare{
		usage:  max(0, 100-percent(curr.Idle, prev.Idle)),
		iowait: percent(curr.IOWait, prev.IOWait),
		steal:  percent(curr.Steal, prev.Steal),
	}
}
