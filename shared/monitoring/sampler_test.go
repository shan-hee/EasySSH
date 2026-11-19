package monitoring

import (
	"testing"
	"time"
)

func metricsOutput(cpu, cpu0, cpu1, ens18, docker0 string) string {
	return `=== CPU ===
cpu  ` + cpu + `
cpu0 ` + cpu0 + `
cpu1 ` + cpu1 + `
=== MEMORY ===
MemTotal:        8000 kB
MemFree:         1000 kB
MemAvailable:    5000 kB
Buffers:          500 kB
Cached:          2000 kB
SReclaimable:    1000 kB
SwapTotal:       2000 kB
SwapFree:        1500 kB
=== NETWORK ===
    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0
 ens18: ` + ens18 + ` 1 0 0 0 0 0 0 ` + ens18 + ` 1 0 0 0 0 0 0
docker0: ` + docker0 + ` 1 0 0 0 0 0 0 ` + docker0 + ` 1 0 0 0 0 0 0
=== NETROUTE ===
ens18
=== NETVIRT ===
docker0
lo
=== DISK ===
/dev/sda1 ext4 107374182400 53687091200 53687091200 50% /
/dev/sda1 ext4 107374182400 53687091200 53687091200 50% /var/lib/docker/bind
/dev/sdb1 xfs 214748364800 21474836480 193273528320 10% /data dir
=== INODE ===
1000 250 /
2000 100 /data dir
`
}

func TestParseMetricsOutputFiltersVirtualInterfacesAndDuplicateMounts(t *testing.T) {
	snapshot := ParseMetricsOutput(metricsOutput("100 0 100 800 0 0 0 0", "50 0 50 400 0 0 0 0", "50 0 50 400 0 0 0 0", "1000", "5000"))

	if len(snapshot.CPUCores) != 2 {
		t.Fatalf("cores = %d, want 2", len(snapshot.CPUCores))
	}
	if _, ok := snapshot.Network.Interfaces["docker0"]; ok {
		t.Fatal("virtual interface docker0 must not be counted")
	}
	if snapshot.Network.DefaultInterface != "ens18" || snapshot.Network.BytesRecvTotal != 1000 {
		t.Fatalf("network = %+v", snapshot.Network)
	}
	if snapshot.Memory.RAMUsedBytes != 3000*1024 || snapshot.Memory.RAMCacheBytes != 3500*1024 {
		t.Fatalf("memory = %+v", snapshot.Memory)
	}
	if len(snapshot.Disks) != 2 || snapshot.Disks[0].MountPoint != "/" || snapshot.Disks[1].MountPoint != "/data dir" {
		t.Fatalf("disks = %+v", snapshot.Disks)
	}
	if snapshot.Disks[0].FSType != "ext4" || snapshot.Disks[0].InodesUsed != 250 || snapshot.Disks[1].InodesTotal != 2000 {
		t.Fatalf("disk details = %+v", snapshot.Disks)
	}
}

func TestSamplerComputesRatesFromConsecutiveSnapshots(t *testing.T) {
	var sampler Sampler
	start := time.Unix(1000, 0)

	first := sampler.Sample(ParseMetricsOutput(metricsOutput(
		"100 0 100 800 0 0 0 0", "50 0 50 400 0 0 0 0", "50 0 50 400 0 0 0 0", "1000", "0",
	)), start)
	if first.Cpu.UsagePercent != 0 || len(first.Cpu.CoreUsagePercent) != 0 || first.Network.BytesRecvPerSec != 0 {
		t.Fatalf("first sample has no baseline and must report zero rates: %+v", first)
	}
	if first.DiskTotalPercent < 23 || first.DiskTotalPercent > 24 {
		t.Fatalf("disk total percent = %v, want 50G+20G / 100G+200G", first.DiskTotalPercent)
	}

	// 两秒内：总计 100 节拍，其中 idle 50、iowait 20；核 0 满载，核 1 空闲；ens18 收 4000 字节。
	second := sampler.Sample(ParseMetricsOutput(metricsOutput(
		"130 0 100 850 20 0 0 0", "130 0 50 400 20 0 0 0", "50 0 50 450 0 0 0 0", "5000", "0",
	)), start.Add(2*time.Second))
	if second.Cpu.UsagePercent != 50 || second.Cpu.IowaitPercent != 20 {
		t.Fatalf("cpu = %+v", second.Cpu)
	}
	if got := second.Cpu.CoreUsagePercent; len(got) != 2 || got[0] != 100 || got[1] != 0 {
		t.Fatalf("core usage = %v", got)
	}
	if second.Network.BytesRecvPerSec != 2000 || len(second.Network.Interfaces) != 1 || second.Network.Interfaces[0].Name != "ens18" {
		t.Fatalf("network = %+v", second.Network)
	}
}
