package dockerutil

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const DefaultResourceStatsLimit = 50

type Container struct {
	ID      string            `json:"id"`
	Names   []string          `json:"names"`
	Image   string            `json:"image"`
	ImageID string            `json:"imageId"`
	Command string            `json:"command"`
	Created int64             `json:"created"`
	Status  string            `json:"status"`
	State   string            `json:"state"`
	Ports   []Port            `json:"ports"`
	Labels  map[string]string `json:"labels"`
	Mounts  []Mount           `json:"mounts"`
}

type Port struct {
	IP          string `json:"ip,omitempty"`
	PrivatePort int    `json:"privatePort"`
	PublicPort  int    `json:"publicPort,omitempty"`
	Type        string `json:"type"`
}

type Mount struct {
	Type        string `json:"type"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Mode        string `json:"mode"`
	RW          bool   `json:"rw"`
}

type ContainerStats struct {
	ContainerID   string  `json:"containerId"`
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryUsage   int64   `json:"memoryUsage"`
	MemoryLimit   int64   `json:"memoryLimit"`
	MemoryPercent float64 `json:"memoryPercent"`
	NetworkIn     int64   `json:"networkIn"`
	NetworkOut    int64   `json:"networkOut"`
	BlockRead     int64   `json:"blockRead"`
	BlockWrite    int64   `json:"blockWrite"`
	PIDs          int     `json:"pids"`
}

type Image struct {
	ID          string `json:"id"`
	Repository  string `json:"repository"`
	Tag         string `json:"tag"`
	Created     int64  `json:"created"`
	Size        int64  `json:"size"`
	VirtualSize int64  `json:"virtualSize"`
}

type SystemInfo struct {
	ContainersRunning int    `json:"containersRunning"`
	ContainersPaused  int    `json:"containersPaused"`
	ContainersStopped int    `json:"containersStopped"`
	ContainersTotal   int    `json:"containersTotal"`
	ImagesCount       int    `json:"imagesCount"`
	DockerVersion     string `json:"dockerVersion"`
	ServerVersion     string `json:"serverVersion"`
	StorageDriver     string `json:"storageDriver"`
	TotalMemory       int64  `json:"totalMemory"`
	CPUs              int    `json:"cpus"`
}

type StatsMeta struct {
	RunningTotal int `json:"RunningTotal"`
	StatsLimit   int `json:"StatsLimit"`
	StatsSampled int `json:"StatsSampled"`
}

type PSMeta struct {
	Status string
	State  string
	Names  []string
}

type InspectPortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

type sockContainerSummary struct {
	ID      string            `json:"Id"`
	Names   []string          `json:"Names"`
	Image   string            `json:"Image"`
	ImageID string            `json:"ImageID"`
	Command string            `json:"Command"`
	Created int64             `json:"Created"`
	State   string            `json:"State"`
	Status  string            `json:"Status"`
	Ports   []Port            `json:"Ports"`
	Labels  map[string]string `json:"Labels"`
	Mounts  []sockMount       `json:"Mounts"`
}

type sockMount struct {
	Type        string `json:"Type"`
	Source      string `json:"Source"`
	Destination string `json:"Destination"`
	Mode        string `json:"Mode"`
	RW          bool   `json:"RW"`
}

type inspectContainer struct {
	ID      string   `json:"Id"`
	Name    string   `json:"Name"`
	Image   string   `json:"Image"`
	Created string   `json:"Created"`
	Path    string   `json:"Path"`
	Args    []string `json:"Args"`
	State   struct {
		Status string `json:"Status"`
	} `json:"State"`
	Config struct {
		Image  string            `json:"Image"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	NetworkSettings struct {
		Ports map[string][]InspectPortBinding `json:"Ports"`
	} `json:"NetworkSettings"`
	Mounts []struct {
		Type        string `json:"Type"`
		Source      string `json:"Source"`
		Destination string `json:"Destination"`
		Mode        string `json:"Mode"`
		RW          bool   `json:"RW"`
	} `json:"Mounts"`
}

func BuildResourcesScript(statsLimit int) string {
	if statsLimit <= 0 {
		statsLimit = DefaultResourceStatsLimit
	}
	return strings.ReplaceAll(`
_stats_limit=__EASYSSH_STATS_LIMIT__
echo "=== INFO ==="
docker info --format '{"Containers":{{.Containers}},"ContainersRunning":{{.ContainersRunning}},"ContainersPaused":{{.ContainersPaused}},"ContainersStopped":{{.ContainersStopped}},"Images":{{.Images}},"DockerVersion":"{{.ServerVersion}}","ServerVersion":"{{.ServerVersion}}","Driver":"{{.Driver}}","MemTotal":{{.MemTotal}},"NCPU":{{.NCPU}}}' 2>/dev/null || echo '{}'
_stats_ids=$(docker ps -q --no-trunc 2>/dev/null || true)
_stats_total=$(printf '%s\n' "$_stats_ids" | awk 'NF { n++ } END { print n + 0 }')
_stats_sample=$(printf '%s\n' "$_stats_ids" | awk -v limit="$_stats_limit" 'NF && n < limit { print; n++ }')
_stats_sampled=$(printf '%s\n' "$_stats_sample" | awk 'NF { n++ } END { print n + 0 }')
echo "=== STATS_META ==="
printf '{"RunningTotal":%s,"StatsLimit":%s,"StatsSampled":%s}\n' "${_stats_total:-0}" "$_stats_limit" "${_stats_sampled:-0}"
echo "=== STATS ==="
if [ -n "$_stats_sample" ]; then
  docker stats --no-stream --format '{{json .}}' $_stats_sample 2>/dev/null || true
fi
`, "__EASYSSH_STATS_LIMIT__", strconv.Itoa(statsLimit))
}

func ParseStatsMeta(data string) StatsMeta {
	var meta StatsMeta
	_ = json.Unmarshal([]byte(strings.TrimSpace(data)), &meta)
	return meta
}

func ParseContainersFromSock(data string) ([]Container, error) {
	data = strings.TrimSpace(data)
	if data == "" || data == "[]" {
		return []Container{}, nil
	}

	var raw []sockContainerSummary
	if err := json.Unmarshal([]byte(data), &raw); err != nil {
		return nil, err
	}

	containers := make([]Container, 0, len(raw))
	for _, item := range raw {
		names := make([]string, 0, len(item.Names))
		for _, name := range item.Names {
			name = strings.TrimSpace(strings.TrimPrefix(name, "/"))
			if name != "" {
				names = append(names, name)
			}
		}

		mounts := make([]Mount, 0, len(item.Mounts))
		for _, mount := range item.Mounts {
			mounts = append(mounts, Mount{
				Type:        mount.Type,
				Source:      mount.Source,
				Destination: mount.Destination,
				Mode:        mount.Mode,
				RW:          mount.RW,
			})
		}

		labels := item.Labels
		if labels == nil {
			labels = map[string]string{}
		}

		containers = append(containers, Container{
			ID:      item.ID,
			Names:   names,
			Image:   item.Image,
			ImageID: item.ImageID,
			Command: item.Command,
			Created: item.Created,
			Status:  item.Status,
			State:   strings.ToLower(item.State),
			Ports:   item.Ports,
			Labels:  labels,
			Mounts:  mounts,
		})
	}

	return containers, nil
}

func ParseInspectContainers(data string, meta map[string]PSMeta) ([]Container, error) {
	data = strings.TrimSpace(data)
	if data == "" {
		return []Container{}, nil
	}

	var inspected []inspectContainer
	if err := json.Unmarshal([]byte(data), &inspected); err != nil {
		return nil, err
	}

	containers := make([]Container, 0, len(inspected))
	for _, item := range inspected {
		labels := item.Config.Labels
		if labels == nil {
			labels = map[string]string{}
		}

		names := []string{}
		if metaItem, ok := meta[item.ID]; ok && len(metaItem.Names) > 0 {
			names = metaItem.Names
		} else if item.Name != "" {
			name := strings.TrimPrefix(strings.TrimSpace(item.Name), "/")
			if name != "" {
				names = []string{name}
			}
		}

		createdUnix := int64(0)
		if item.Created != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, item.Created); err == nil {
				createdUnix = parsed.Unix()
			} else if parsed, err := time.Parse(time.RFC3339, item.Created); err == nil {
				createdUnix = parsed.Unix()
			}
		}

		mounts := make([]Mount, 0, len(item.Mounts))
		for _, mount := range item.Mounts {
			mounts = append(mounts, Mount{
				Type:        mount.Type,
				Source:      mount.Source,
				Destination: mount.Destination,
				Mode:        mount.Mode,
				RW:          mount.RW,
			})
		}

		status := ""
		state := strings.ToLower(item.State.Status)
		if metaItem, ok := meta[item.ID]; ok {
			status = metaItem.Status
			if metaItem.State != "" {
				state = strings.ToLower(metaItem.State)
			}
		}
		if status == "" {
			status = item.State.Status
		}

		containers = append(containers, Container{
			ID:      item.ID,
			Names:   names,
			Image:   item.Config.Image,
			ImageID: item.Image,
			Command: strings.TrimSpace(strings.Join(append([]string{item.Path}, item.Args...), " ")),
			Created: createdUnix,
			Status:  status,
			State:   state,
			Ports:   ParseInspectPorts(item.NetworkSettings.Ports),
			Labels:  labels,
			Mounts:  mounts,
		})
	}

	return containers, nil
}

func ParsePSMeta(output string) map[string]PSMeta {
	result := map[string]PSMeta{}
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 4 {
			continue
		}
		id := strings.TrimSpace(parts[0])
		if id == "" {
			continue
		}
		names := []string{}
		for _, name := range strings.Split(parts[3], ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				names = append(names, name)
			}
		}
		result[id] = PSMeta{
			Status: strings.TrimSpace(parts[1]),
			State:  strings.TrimSpace(parts[2]),
			Names:  names,
		}
	}
	return result
}

func ParseInspectPorts(ports map[string][]InspectPortBinding) []Port {
	if len(ports) == 0 {
		return []Port{}
	}

	result := []Port{}
	for containerPortSpec, bindings := range ports {
		spec := strings.TrimSpace(containerPortSpec)
		if spec == "" {
			continue
		}

		privateStr, proto := spec, "tcp"
		if strings.Contains(spec, "/") {
			parts := strings.SplitN(spec, "/", 2)
			privateStr = parts[0]
			if parts[1] != "" {
				proto = parts[1]
			}
		}

		privatePort, err := strconv.Atoi(privateStr)
		if err != nil || privatePort <= 0 {
			continue
		}

		if len(bindings) == 0 {
			result = append(result, Port{PrivatePort: privatePort, Type: proto})
			continue
		}

		for _, binding := range bindings {
			publicPort, _ := strconv.Atoi(strings.TrimSpace(binding.HostPort))
			result = append(result, Port{
				IP:          strings.TrimSpace(binding.HostIP),
				PrivatePort: privatePort,
				PublicPort:  publicPort,
				Type:        proto,
			})
		}
	}
	return result
}

func ParseSections(output string) map[string]string {
	sections := map[string]string{}
	var currentSection string
	sectionLines := []string{}

	for _, line := range strings.Split(output, "\n") {
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

func ParsePSContainers(data string) []Container {
	containers := []Container{}
	for _, line := range strings.Split(strings.TrimSpace(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == "[]" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		container := Container{
			ID:      getString(raw, "ID"),
			Image:   getString(raw, "Image"),
			Command: getString(raw, "Command"),
			Status:  getString(raw, "Status"),
			State:   strings.ToLower(getString(raw, "State")),
			Labels:  map[string]string{},
			Mounts:  []Mount{},
		}

		if names := getString(raw, "Names"); names != "" {
			container.Names = strings.Split(names, ",")
		}

		if createdAt := getString(raw, "CreatedAt"); createdAt != "" {
			if parsed, err := time.Parse("2006-01-02 15:04:05 -0700 MST", createdAt); err == nil {
				container.Created = parsed.Unix()
			}
		}

		if ports := getString(raw, "Ports"); ports != "" {
			container.Ports = ParsePortList(ports)
		}

		if labels := getString(raw, "Labels"); labels != "" {
			for _, kv := range strings.Split(labels, ",") {
				parts := strings.SplitN(kv, "=", 2)
				if len(parts) == 2 {
					container.Labels[parts[0]] = parts[1]
				}
			}
		}

		if mounts := getString(raw, "Mounts"); mounts != "" {
			for _, mount := range strings.Split(mounts, ",") {
				if mount != "" {
					container.Mounts = append(container.Mounts, Mount{Source: mount})
				}
			}
		}

		containers = append(containers, container)
	}
	return containers
}

func ParsePortList(ports string) []Port {
	result := []Port{}
	for _, item := range strings.Split(ports, ", ") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}

		port := Port{Type: "tcp"}
		if strings.HasSuffix(item, "/udp") {
			port.Type = "udp"
			item = strings.TrimSuffix(item, "/udp")
		} else if strings.HasSuffix(item, "/tcp") {
			item = strings.TrimSuffix(item, "/tcp")
		}

		if strings.Contains(item, "->") {
			parts := strings.Split(item, "->")
			if len(parts) == 2 {
				hostPart := parts[0]
				if strings.Contains(hostPart, ":") {
					hostParts := strings.Split(hostPart, ":")
					if len(hostParts) == 2 {
						port.IP = hostParts[0]
						port.PublicPort, _ = strconv.Atoi(hostParts[1])
					}
				} else {
					port.PublicPort, _ = strconv.Atoi(hostPart)
				}
				port.PrivatePort, _ = strconv.Atoi(parts[1])
			}
		} else {
			port.PrivatePort, _ = strconv.Atoi(item)
		}

		if port.PrivatePort > 0 {
			result = append(result, port)
		}
	}
	return result
}

func ParseStats(data string) []ContainerStats {
	stats := []ContainerStats{}
	for _, line := range strings.Split(strings.TrimSpace(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == "[]" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		memoryUsage, memoryLimit := ParseSizePair(getString(raw, "MemUsage"))
		networkIn, networkOut := ParseSizePair(getString(raw, "NetIO"))
		blockRead, blockWrite := ParseSizePair(getString(raw, "BlockIO"))
		pids, _ := strconv.Atoi(getString(raw, "PIDs"))

		stats = append(stats, ContainerStats{
			ContainerID:   getString(raw, "ID"),
			Name:          getString(raw, "Name"),
			CPUPercent:    ParsePercent(getString(raw, "CPUPerc")),
			MemoryUsage:   memoryUsage,
			MemoryLimit:   memoryLimit,
			MemoryPercent: ParsePercent(getString(raw, "MemPerc")),
			NetworkIn:     networkIn,
			NetworkOut:    networkOut,
			BlockRead:     blockRead,
			BlockWrite:    blockWrite,
			PIDs:          pids,
		})
	}
	return stats
}

func ParseImages(data string) []Image {
	images := []Image{}
	for _, line := range strings.Split(strings.TrimSpace(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == "[]" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		createdUnix := int64(0)
		if createdAt := getString(raw, "CreatedAt"); createdAt != "" {
			if parsed, err := time.Parse("2006-01-02 15:04:05 -0700 MST", createdAt); err == nil {
				createdUnix = parsed.Unix()
			}
		}

		size := ParseSize(getString(raw, "Size"))
		virtualSize := ParseSize(getString(raw, "VirtualSize"))
		if virtualSize == 0 {
			virtualSize = size
		}

		images = append(images, Image{
			ID:          getString(raw, "ID"),
			Repository:  getString(raw, "Repository"),
			Tag:         getString(raw, "Tag"),
			Created:     createdUnix,
			Size:        size,
			VirtualSize: virtualSize,
		})
	}
	return images
}

func ParseSystemInfo(data string) *SystemInfo {
	data = strings.TrimSpace(data)
	if data == "" || data == "{}" {
		return nil
	}

	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(data), &raw); err != nil {
		return nil
	}

	serverVersion := getString(raw, "ServerVersion")
	dockerVersion := getString(raw, "DockerVersion")
	if dockerVersion == "" {
		dockerVersion = serverVersion
	}

	return &SystemInfo{
		ContainersRunning: getInt(raw, "ContainersRunning"),
		ContainersPaused:  getInt(raw, "ContainersPaused"),
		ContainersStopped: getInt(raw, "ContainersStopped"),
		ContainersTotal:   getInt(raw, "Containers"),
		ImagesCount:       getInt(raw, "Images"),
		DockerVersion:     dockerVersion,
		ServerVersion:     serverVersion,
		StorageDriver:     getString(raw, "Driver"),
		TotalMemory:       getInt64(raw, "MemTotal"),
		CPUs:              getInt(raw, "NCPU"),
	}
}

func ParsePercent(value string) float64 {
	value = strings.TrimSpace(strings.TrimSuffix(value, "%"))
	parsed, _ := strconv.ParseFloat(value, 64)
	return parsed
}

func ParseSizePair(value string) (int64, int64) {
	parts := strings.Split(value, " / ")
	if len(parts) != 2 {
		return 0, 0
	}
	return ParseSize(parts[0]), ParseSize(parts[1])
}

func ParseSize(value string) int64 {
	value = strings.TrimSpace(strings.ToUpper(value))
	if value == "" {
		return 0
	}

	multiplier := int64(1)
	if strings.HasSuffix(value, "B") {
		value = strings.TrimSuffix(value, "B")
	}
	if strings.HasSuffix(value, "I") {
		value = strings.TrimSuffix(value, "I")
	}

	switch {
	case strings.HasSuffix(value, "K"):
		multiplier = 1024
		value = strings.TrimSuffix(value, "K")
	case strings.HasSuffix(value, "M"):
		multiplier = 1024 * 1024
		value = strings.TrimSuffix(value, "M")
	case strings.HasSuffix(value, "G"):
		multiplier = 1024 * 1024 * 1024
		value = strings.TrimSuffix(value, "G")
	case strings.HasSuffix(value, "T"):
		multiplier = 1024 * 1024 * 1024 * 1024
		value = strings.TrimSuffix(value, "T")
	}

	parsed, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return int64(parsed * float64(multiplier))
}

func ParseTail(value string) (int, error) {
	tail, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, fmt.Errorf("tail must be a number")
	}
	if tail < 1 || tail > 5000 {
		return 0, fmt.Errorf("tail must be between 1 and 5000")
	}
	return tail, nil
}

func NormalizeTail(tail int) int {
	if tail <= 0 {
		return 100
	}
	if tail > 5000 {
		return 5000
	}
	return tail
}

func SplitNonEmptyLines(output string) []string {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line != "" {
			result = append(result, line)
		}
	}
	return result
}

func ShellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func NormalizeContainerRef(value string) (string, error) {
	value = strings.TrimSpace(strings.TrimPrefix(value, "/"))
	if value == "" {
		return "", errors.New("container id is required")
	}
	if !ValidateContainerRef(value) {
		return "", errors.New("container id contains invalid characters")
	}
	return value, nil
}

func ValidateContainerRef(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 255 {
		return false
	}
	if !isRefStart(rune(value[0])) {
		return false
	}

	for _, r := range value {
		if isRefPart(r, false) {
			continue
		}
		return false
	}
	return true
}

func ValidateImageRef(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 255 {
		return false
	}
	if !isRefStart(rune(value[0])) {
		return false
	}

	for _, r := range value {
		if isRefPart(r, true) {
			continue
		}
		return false
	}
	return true
}

func isRefStart(r rune) bool {
	return (r >= 'a' && r <= 'z') ||
		(r >= 'A' && r <= 'Z') ||
		(r >= '0' && r <= '9')
}

func isRefPart(r rune, image bool) bool {
	if (r >= 'a' && r <= 'z') ||
		(r >= 'A' && r <= 'Z') ||
		(r >= '0' && r <= '9') ||
		r == '_' ||
		r == '.' ||
		r == '-' ||
		r == ':' {
		return true
	}
	return image && (r == '/' || r == '@' || r == '+')
}

func getString(data map[string]interface{}, key string) string {
	if value, ok := data[key]; ok {
		switch item := value.(type) {
		case string:
			return item
		case fmt.Stringer:
			return item.String()
		}
	}
	return ""
}

func getInt(data map[string]interface{}, key string) int {
	if value, ok := data[key]; ok {
		switch item := value.(type) {
		case float64:
			return int(item)
		case int:
			return item
		case int64:
			return int(item)
		}
	}
	return 0
}

func getInt64(data map[string]interface{}, key string) int64 {
	if value, ok := data[key]; ok {
		switch item := value.(type) {
		case float64:
			return int64(item)
		case int:
			return int64(item)
		case int64:
			return item
		}
	}
	return 0
}
