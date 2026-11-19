package app

import (
	"github.com/easyssh/shared/monitoring"
	"github.com/easyssh/shared/monitorwire"
	"google.golang.org/protobuf/proto"
)

func encodeDesktopMonitorProto(sample desktopMonitorSample, sampler *monitoring.Sampler) ([]byte, error) {
	snapshot := sample.metrics
	metrics := sampler.Sample(snapshot, sample.collectedAt)
	metrics.SystemInfo = &monitorwire.SystemInfo{
		Os:            snapshot.SystemInfo.OS,
		Hostname:      snapshot.SystemInfo.Hostname,
		CpuModel:      snapshot.SystemInfo.CPUModel,
		Arch:          snapshot.SystemInfo.Arch,
		LoadAvg:       snapshot.SystemInfo.LoadAvg,
		UptimeSeconds: snapshot.SystemInfo.UptimeSeconds,
		CpuCores:      snapshot.SystemInfo.CPUCores,
	}
	metrics.Cpu.CoreCount = snapshot.SystemInfo.CPUCores
	metrics.Timestamp = sample.collectedAt.Unix()
	metrics.SshLatencyMs = sample.latencyMs
	metrics.Docker = &monitorwire.DockerStats{
		ContainersRunning: snapshot.Docker.ContainersRunning,
		ContainersTotal:   snapshot.Docker.ContainersTotal,
		DockerInstalled:   snapshot.Docker.DockerInstalled,
	}
	return proto.Marshal(metrics)
}
