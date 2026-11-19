package monitoring

import (
	"fmt"
	"sort"
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

// CPUStat 是 /proc/stat 中一行 cpu 的累计节拍。guest 时间已包含在 user/nice 中，不单独累加。
type CPUStat struct {
	User    uint64
	Nice    uint64
	System  uint64
	Idle    uint64
	IOWait  uint64
	IRQ     uint64
	SoftIRQ uint64
	Steal   uint64
}

func (c CPUStat) Total() uint64 {
	return c.User + c.Nice + c.System + c.Idle + c.IOWait +
		c.IRQ + c.SoftIRQ + c.Steal
}

func (c CPUStat) IdleTotal() uint64 {
	return c.Idle + c.IOWait
}

type MemoryMetrics struct {
	RAMUsedBytes   uint64
	RAMTotalBytes  uint64
	RAMCacheBytes  uint64
	SwapUsedBytes  uint64
	SwapTotalBytes uint64
}

type NetStat struct {
	RxBytes uint64
	TxBytes uint64
}

// NetworkMetrics 只包含物理网卡和默认路由网卡；容器网桥、veth 等虚拟网卡会重复计数同一份流量。
type NetworkMetrics struct {
	Interfaces       map[string]NetStat
	DefaultInterface string
	BytesRecvTotal   uint64
	BytesSentTotal   uint64
}

type DiskMetrics struct {
	MountPoint  string
	Device      string
	FSType      string
	UsedBytes   uint64
	TotalBytes  uint64
	InodesUsed  uint64
	InodesTotal uint64
}

type DockerStats struct {
	ContainersRunning uint32
	ContainersTotal   uint32
	DockerInstalled   bool
}

type MetricsSnapshot struct {
	SystemInfo SystemInfo
	CPU        CPUStat
	CPUCores   []CPUStat
	Memory     MemoryMetrics
	Network    NetworkMetrics
	Disks      []DiskMetrics
	Docker     DockerStats
}

func ParseMetricsOutput(output string) MetricsSnapshot {
	sections := parseSections(output)
	cpu, cores := parseCPU(sections["CPU"])

	return MetricsSnapshot{
		SystemInfo: parseSystemInfo(sections["SYSINFO"], sections["LOAD"], sections["UPTIME"]),
		CPU:        cpu,
		CPUCores:   cores,
		Memory:     parseMemory(sections["MEMORY"]),
		Network:    parseNetwork(sections["NETWORK"], sections["NETROUTE"], sections["NETVIRT"]),
		Disks:      parseDisk(sections["DISK"], sections["INODE"]),
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

// parseCPU 返回合计行和按出现顺序（即核心编号）排列的每核心数据。
func parseCPU(data string) (CPUStat, []CPUStat) {
	var total CPUStat
	cores := []CPUStat{}

	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 9 || !strings.HasPrefix(fields[0], "cpu") {
			continue
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
		if fields[0] == "cpu" {
			total = stat
		} else {
			cores = append(cores, stat)
		}
	}

	return total, cores
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
	ramFree := memData["MemFree"]
	available, ok := memData["MemAvailable"]
	if !ok {
		available = ramFree + memData["Buffers"] + memData["Cached"]
	}
	// 缓存只取 available 中超出 free 的部分，保证 已用 + 缓存 + 空闲 不超过总量。
	cache := min(memData["Buffers"]+memData["Cached"]+memData["SReclaimable"], SubtractUint64(available, ramFree))
	swapTotal := memData["SwapTotal"]

	return MemoryMetrics{
		RAMUsedBytes:   SubtractUint64(ramTotal, available),
		RAMTotalBytes:  ramTotal,
		RAMCacheBytes:  cache,
		SwapUsedBytes:  SubtractUint64(swapTotal, memData["SwapFree"]),
		SwapTotalBytes: swapTotal,
	}
}

// parseNetwork 统计物理网卡和默认路由网卡。容器、OpenVZ 内的唯一网卡本身是虚拟网卡，
// 所以默认路由网卡始终计入；拿不到 /sys 虚拟网卡列表时退回统计全部非 lo 网卡。
func parseNetwork(data, routeData, virtualData string) NetworkMetrics {
	defaultIface := strings.TrimSpace(routeData)
	virtual := make(map[string]bool)
	for _, name := range strings.Fields(virtualData) {
		virtual[name] = true
	}

	stats := make(map[string]NetStat)
	var totalRx uint64
	var totalTx uint64

	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 10 {
			continue
		}

		iface := strings.TrimSuffix(fields[0], ":")
		if iface == "lo" || (virtual[iface] && iface != defaultIface) {
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
		Interfaces:       stats,
		DefaultInterface: defaultIface,
		BytesRecvTotal:   totalRx,
		BytesSentTotal:   totalTx,
	}
}

// parseDisk 解析脚本输出的 "设备 类型 总量 已用 可用 使用率 挂载点" 行，
// 同一设备（bind mount、btrfs 子卷）只保留路径最短的挂载点，避免容量重复计算。
func parseDisk(data, inodeData string) []DiskMetrics {
	inodes := make(map[string][2]uint64)
	for _, line := range strings.Split(inodeData, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		inodes[strings.Join(fields[2:], " ")] = [2]uint64{parseUint64(fields[0]), parseUint64(fields[1])}
	}

	byDevice := make(map[string]int)
	disks := []DiskMetrics{}
	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}

		device := fields[0]
		total := parseUint64(fields[2])
		if total < 100*1024*1024 || device == "tmpfs" || device == "devtmpfs" || device == "overlay" {
			continue
		}

		mountPoint := strings.Join(fields[6:], " ")
		fsType := fields[1]
		if fsType == "-" {
			fsType = ""
		}
		disk := DiskMetrics{
			MountPoint:  mountPoint,
			Device:      device,
			FSType:      fsType,
			UsedBytes:   parseUint64(fields[3]),
			TotalBytes:  total,
			InodesTotal: inodes[mountPoint][0],
			InodesUsed:  inodes[mountPoint][1],
		}

		if index, ok := byDevice[device]; ok {
			if len(mountPoint) < len(disks[index].MountPoint) {
				disks[index] = disk
			}
			continue
		}
		byDevice[device] = len(disks)
		disks = append(disks, disk)
	}

	sort.SliceStable(disks, func(i, j int) bool {
		if disks[i].MountPoint == "/" || disks[j].MountPoint == "/" {
			return disks[i].MountPoint == "/"
		}
		return disks[i].MountPoint < disks[j].MountPoint
	})
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
