//go:build js && wasm

package main

import (
	"context"
	"github.com/easyssh/shared/monitoring"
	"golang.org/x/crypto/ssh"
	"time"
)

// Requests are serialized by the worker, so each connection has one sample.
var previousMetrics *monitoring.MetricsSnapshot
var previousMetricsAt time.Time

func (r *runtime) metrics(client *ssh.Client) (any, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()
	ctx, cancel := context.WithTimeout(r.ctx, 15*time.Second)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { session.Close() })
	defer stop()
	output := &boundedOutput{limit: 1 << 20}
	session.Stdout = output
	session.Stderr = output
	start := time.Now()
	if err = session.Run(monitoring.BuildMetricsScript(monitoring.MetricsScriptOptions{IncludeStaticInfo: true, IncludeDockerStats: true})); err != nil {
		return nil, err
	}
	sample := monitoring.ParseMetricsOutput(string(output.data))
	now := time.Now()
	cpu, received, sent := float64(0), float64(0), float64(0)
	if previousMetrics != nil {
		total := monitoring.SubtractUint64(sample.CPU.Total(), previousMetrics.CPU.Total())
		idle := monitoring.SubtractUint64(sample.CPU.IdleTotal(), previousMetrics.CPU.IdleTotal())
		if total > 0 && idle <= total {
			cpu = 100 * float64(total-idle) / float64(total)
		}
		elapsed := now.Sub(previousMetricsAt).Seconds()
		if elapsed > 0 {
			received = float64(monitoring.SubtractUint64(sample.Network.BytesRecvTotal, previousMetrics.Network.BytesRecvTotal)) / elapsed
			sent = float64(monitoring.SubtractUint64(sample.Network.BytesSentTotal, previousMetrics.Network.BytesSentTotal)) / elapsed
		}
	}
	previousMetrics = &sample
	previousMetricsAt = now
	disks := []map[string]any{}
	var total, used uint64
	for _, disk := range sample.Disks {
		total += disk.TotalBytes
		used += disk.UsedBytes
		disks = append(disks, map[string]any{"mountPoint": disk.MountPoint, "usedBytes": disk.UsedBytes, "totalBytes": disk.TotalBytes})
	}
	diskPercent := float64(0)
	if total > 0 {
		diskPercent = 100 * float64(used) / float64(total)
	}
	info := sample.SystemInfo
	memory := sample.Memory
	return map[string]any{
		"systemInfo": map[string]any{"os": info.OS, "hostname": info.Hostname, "cpuModel": info.CPUModel, "arch": info.Arch, "loadAvg": info.LoadAvg, "uptimeSeconds": info.UptimeSeconds, "cpuCores": info.CPUCores},
		"cpu":        map[string]any{"usagePercent": cpu, "coreCount": info.CPUCores},
		"memory":     map[string]any{"ramUsedBytes": memory.RAMUsedBytes, "ramTotalBytes": memory.RAMTotalBytes, "swapUsedBytes": memory.SwapUsedBytes, "swapTotalBytes": memory.SwapTotalBytes},
		"network":    map[string]any{"bytesRecvPerSec": received, "bytesSentPerSec": sent},
		"disks":      disks, "diskTotalPercent": diskPercent, "timestamp": now.UnixMilli(), "sshLatencyMs": now.Sub(start).Milliseconds(),
		"docker": map[string]any{"containersRunning": sample.Docker.ContainersRunning, "containersTotal": sample.Docker.ContainersTotal, "dockerInstalled": sample.Docker.DockerInstalled},
	}, nil
}
