package monitoring

import (
	"fmt"
	"strconv"
	"strings"
)

type SystemInfo struct {
	OS            string
	Hostname      string
	CPUModel      string
	Arch          string
	LoadAvg       string
	UptimeSeconds uint64
	CPUCores      uint32
}

type CPUStat struct {
	User      uint64
	Nice      uint64
	System    uint64
	Idle      uint64
	IOWait    uint64
	IRQ       uint64
	SoftIRQ   uint64
	Steal     uint64
	Guest     uint64
	GuestNice uint64
}

func (c CPUStat) Total() uint64 {
	return c.User + c.Nice + c.System + c.Idle + c.IOWait +
		c.IRQ + c.SoftIRQ + c.Steal + c.Guest + c.GuestNice
}

func (c CPUStat) IdleTotal() uint64 {
	return c.Idle + c.IOWait
}

type MemoryMetrics struct {
	RAMUsedBytes   uint64
	RAMTotalBytes  uint64
	SwapUsedBytes  uint64
	SwapTotalBytes uint64
}

type NetStat struct {
	RxBytes uint64
	TxBytes uint64
}

type NetworkMetrics struct {
	Interfaces     map[string]NetStat
	BytesRecvTotal uint64
	BytesSentTotal uint64
}

type DiskMetrics struct {
	MountPoint string
	UsedBytes  uint64
	TotalBytes uint64
}

type DockerStats struct {
	ContainersRunning uint32
	ContainersTotal   uint32
	DockerInstalled   bool
}

type MetricsSnapshot struct {
	SystemInfo SystemInfo
	CPU        CPUStat
	Memory     MemoryMetrics
	Network    NetworkMetrics
	Disks      []DiskMetrics
	Docker     DockerStats
}

func ParseMetricsOutput(output string) MetricsSnapshot {
	sections := parseSections(output)

	return MetricsSnapshot{
		SystemInfo: parseSystemInfo(sections["SYSINFO"], sections["LOAD"], sections["UPTIME"]),
		CPU:        parseCPU(sections["CPU"]),
		Memory:     parseMemory(sections["MEMORY"]),
		Network:    parseNetwork(sections["NETWORK"]),
		Disks:      parseDisk(sections["DISK"]),
		Docker:     parseDocker(sections["DOCKER"]),
	}
}

func ParseDockerStatsOutput(output string) DockerStats {
	return parseDocker(output)
}

func parseSections(output string) map[string]string {
	sections := make(map[string]string)
	lines := strings.Split(output, "\n")

	var currentSection string
	var sectionLines []string

	for _, line := range lines {
		if strings.HasPrefix(line, "=== ") && strings.HasSuffix(line, " ===") {
			if currentSection != "" {
				sections[currentSection] = strings.Join(sectionLines, "\n")
			}
			currentSection = strings.Trim(line, "= ")
			sectionLines = []string{}
			continue
		}
		if currentSection != "" {
			sectionLines = append(sectionLines, line)
		}
	}

	if currentSection != "" {
		sections[currentSection] = strings.Join(sectionLines, "\n")
	}

	return sections
}

func parseCPU(data string) CPUStat {
	fields := strings.Fields(data)
	if len(fields) < 9 {
		return CPUStat{}
	}

	stat := CPUStat{
		User:    parseUint64(fields[1]),
		Nice:    parseUint64(fields[2]),
		System:  parseUint64(fields[3]),
		Idle:    parseUint64(fields[4]),
		IOWait:  parseUint64(fields[5]),
		IRQ:     parseUint64(fields[6]),
		SoftIRQ: parseUint64(fields[7]),
		Steal:   parseUint64(fields[8]),
	}

	if len(fields) >= 11 {
		stat.Guest = parseUint64(fields[9])
		stat.GuestNice = parseUint64(fields[10])
	}

	return stat
}

func parseMemory(data string) MemoryMetrics {
	memData := make(map[string]uint64)

	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) >= 2 {
			key := strings.TrimSuffix(fields[0], ":")
			memData[key] = parseUint64(fields[1]) * 1024
		}
	}

	ramTotal := memData["MemTotal"]
	ramUsed := uint64(0)
	if available, ok := memData["MemAvailable"]; ok {
		ramUsed = SubtractUint64(ramTotal, available)
	} else {
		reclaimable := memData["MemFree"] + memData["Buffers"] + memData["Cached"]
		ramUsed = SubtractUint64(ramTotal, reclaimable)
	}
	swapTotal := memData["SwapTotal"]
	swapUsed := SubtractUint64(swapTotal, memData["SwapFree"])

	return MemoryMetrics{
		RAMUsedBytes:   ramUsed,
		RAMTotalBytes:  ramTotal,
		SwapUsedBytes:  swapUsed,
		SwapTotalBytes: swapTotal,
	}
}

func parseNetwork(data string) NetworkMetrics {
	stats := make(map[string]NetStat)
	var totalRx uint64
	var totalTx uint64

	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 10 {
			continue
		}

		iface := strings.TrimSuffix(fields[0], ":")
		if iface == "lo" {
			continue
		}

		stat := NetStat{
			RxBytes: parseUint64(fields[1]),
			TxBytes: parseUint64(fields[9]),
		}
		stats[iface] = stat
		totalRx += stat.RxBytes
		totalTx += stat.TxBytes
	}

	return NetworkMetrics{
		Interfaces:     stats,
		BytesRecvTotal: totalRx,
		BytesSentTotal: totalTx,
	}
}

func parseDisk(data string) []DiskMetrics {
	disks := []DiskMetrics{}

	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 6 {
			continue
		}

		fsName := fields[0]
		total := parseUint64(fields[1])
		used := parseUint64(fields[2])
		mountPoint := fields[5]

		if fsName == "total" || mountPoint == "-" {
			mountPoint = "/"
		}
		if total < 100*1024*1024 {
			continue
		}

		disks = append(disks, DiskMetrics{
			MountPoint: mountPoint,
			UsedBytes:  used,
			TotalBytes: total,
		})
	}

	return disks
}

func parseSystemInfo(sysData, loadData, uptimeData string) SystemInfo {
	sysLines := strings.Split(strings.TrimSpace(sysData), "\n")
	info := SystemInfo{}

	if len(sysLines) >= 1 {
		info.OS = strings.TrimSpace(sysLines[0])
	}
	if len(sysLines) >= 2 {
		info.Hostname = strings.TrimSpace(sysLines[1])
	}
	if len(sysLines) >= 3 {
		info.CPUModel = strings.TrimSpace(sysLines[2])
	}
	if len(sysLines) >= 4 {
		info.Arch = strings.TrimSpace(sysLines[3])
	}
	if len(sysLines) >= 5 {
		info.CPUCores = uint32(parseUint64(strings.TrimSpace(sysLines[4])))
	}

	loadFields := strings.Fields(strings.TrimSpace(loadData))
	if len(loadFields) >= 3 {
		info.LoadAvg = fmt.Sprintf("%s, %s, %s", loadFields[0], loadFields[1], loadFields[2])
	}

	uptimeFields := strings.Fields(strings.TrimSpace(uptimeData))
	if len(uptimeFields) >= 1 {
		uptime, _ := strconv.ParseFloat(uptimeFields[0], 64)
		info.UptimeSeconds = uint64(uptime)
	}

	return info
}

func parseDocker(data string) DockerStats {
	lines := strings.Split(strings.TrimSpace(data), "\n")
	if len(lines) < 3 {
		return DockerStats{}
	}

	return DockerStats{
		DockerInstalled:   strings.TrimSpace(lines[0]) == "installed",
		ContainersRunning: uint32(parseUint64(lines[1])),
		ContainersTotal:   uint32(parseUint64(lines[2])),
	}
}

func parseUint64(s string) uint64 {
	val, _ := strconv.ParseUint(strings.TrimSpace(s), 10, 64)
	return val
}

func SubtractUint64(a, b uint64) uint64 {
	if b > a {
		return 0
	}
	return a - b
}
