package app

import (
	"github.com/easyssh/shared/monitorwire"
	"google.golang.org/protobuf/proto"
)

func encodeDesktopMonitorSnapshotProto(snapshot DesktopMonitorSnapshot, previous *DesktopMonitorSnapshot) ([]byte, error) {
	disks := make([]*monitorwire.DiskMetrics, 0, len(snapshot.Disks))
	var diskTotal, diskUsed uint64
	for _, disk := range snapshot.Disks {
		diskTotal += disk.TotalBytes
		diskUsed += disk.UsedBytes
		disks = append(disks, &monitorwire.DiskMetrics{
			MountPoint: disk.MountPoint,
			UsedBytes:  disk.UsedBytes,
			TotalBytes: disk.TotalBytes,
		})
	}
	diskPercent := 0.0
	if diskTotal > 0 {
		diskPercent = float64(diskUsed) / float64(diskTotal) * 100
	}
	network := calculateDesktopGatewayNetworkRate(snapshot, previous)
	return proto.Marshal(&monitorwire.SystemMetrics{
		SystemInfo: &monitorwire.SystemInfo{
			Os:            snapshot.SystemInfo.OS,
			Hostname:      snapshot.SystemInfo.Hostname,
			CpuModel:      snapshot.SystemInfo.CPUModel,
			Arch:          snapshot.SystemInfo.Arch,
			LoadAvg:       snapshot.SystemInfo.LoadAvg,
			UptimeSeconds: uint64(max(0, snapshot.SystemInfo.UptimeSeconds)),
			CpuCores:      uint32(max(0, snapshot.SystemInfo.CPUCores)),
		},
		Cpu: &monitorwire.CPUMetrics{
			UsagePercent: calculateDesktopGatewayCPUUsage(snapshot, previous),
			CoreCount:    uint32(max(0, snapshot.CPU.CoreCount)),
		},
		Memory: &monitorwire.MemoryMetrics{
			RamUsedBytes:   snapshot.Memory.RAMUsedBytes,
			RamTotalBytes:  snapshot.Memory.RAMTotalBytes,
			SwapUsedBytes:  snapshot.Memory.SwapUsedBytes,
			SwapTotalBytes: snapshot.Memory.SwapTotalBytes,
		},
		Network: &monitorwire.NetworkMetrics{
			BytesRecvPerSec: network.bytesRecvPerSec,
			BytesSentPerSec: network.bytesSentPerSec,
		},
		Disks:            disks,
		Timestamp:        snapshot.Timestamp,
		DiskTotalPercent: diskPercent,
		SshLatencyMs:     snapshot.SSHLatency,
		Docker: &monitorwire.DockerStats{
			ContainersRunning: uint32(max(0, snapshot.Docker.ContainersRunning)),
			ContainersTotal:   uint32(max(0, snapshot.Docker.ContainersTotal)),
			DockerInstalled:   snapshot.Docker.DockerInstalled,
		},
	})
}
