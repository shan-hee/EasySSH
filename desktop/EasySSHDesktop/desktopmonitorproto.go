package main

import (
	"encoding/binary"
	"math"
)

const (
	desktopProtoWireVarint  = 0
	desktopProtoWireFixed64 = 1
	desktopProtoWireBytes   = 2
)

func encodeDesktopMonitorSnapshotProto(snapshot DesktopMonitorSnapshot, previous *DesktopMonitorSnapshot) []byte {
	disks := make([][]byte, 0, len(snapshot.Disks))
	var diskTotal uint64
	var diskUsed uint64
	for _, disk := range snapshot.Disks {
		diskTotal += disk.TotalBytes
		diskUsed += disk.UsedBytes
		disks = append(disks, encodeDesktopMonitorDiskProto(disk))
	}

	diskPercent := 0.0
	if diskTotal > 0 {
		diskPercent = float64(diskUsed) / float64(diskTotal) * 100
	}

	network := calculateDesktopGatewayNetworkRate(snapshot, previous)
	var out []byte
	out = appendDesktopProtoMessage(out, 1, encodeDesktopMonitorSystemInfoProto(snapshot.SystemInfo), false)
	out = appendDesktopProtoMessage(out, 2, encodeDesktopMonitorCPUProto(snapshot, previous), false)
	out = appendDesktopProtoMessage(out, 3, encodeDesktopMonitorMemoryProto(snapshot.Memory), false)
	out = appendDesktopProtoMessage(out, 4, encodeDesktopMonitorNetworkProto(network), false)
	for _, disk := range disks {
		out = appendDesktopProtoMessage(out, 5, disk, false)
	}
	out = appendDesktopProtoInt64(out, 6, snapshot.Timestamp)
	out = appendDesktopProtoDouble(out, 7, diskPercent)
	out = appendDesktopProtoInt64(out, 8, snapshot.SSHLatency)
	out = appendDesktopProtoMessage(out, 9, encodeDesktopMonitorDockerProto(snapshot.Docker), true)
	return out
}

func encodeDesktopMonitorSystemInfoProto(info DesktopMonitorSystemInfo) []byte {
	var out []byte
	out = appendDesktopProtoString(out, 1, info.OS)
	out = appendDesktopProtoString(out, 2, info.Hostname)
	out = appendDesktopProtoString(out, 3, info.CPUModel)
	out = appendDesktopProtoString(out, 4, info.Arch)
	out = appendDesktopProtoString(out, 5, info.LoadAvg)
	out = appendDesktopProtoUint64(out, 6, uint64(maxInt64(0, info.UptimeSeconds)))
	out = appendDesktopProtoUint32(out, 7, uint32(maxInt(0, info.CPUCores)))
	return out
}

func encodeDesktopMonitorCPUProto(snapshot DesktopMonitorSnapshot, previous *DesktopMonitorSnapshot) []byte {
	var out []byte
	out = appendDesktopProtoDouble(out, 1, calculateDesktopGatewayCPUUsage(snapshot, previous))
	out = appendDesktopProtoUint32(out, 2, uint32(maxInt(0, snapshot.CPU.CoreCount)))
	return out
}

func encodeDesktopMonitorMemoryProto(memory DesktopMonitorMemoryInfo) []byte {
	var out []byte
	out = appendDesktopProtoUint64(out, 1, memory.RAMUsedBytes)
	out = appendDesktopProtoUint64(out, 2, memory.RAMTotalBytes)
	out = appendDesktopProtoUint64(out, 3, memory.SwapUsedBytes)
	out = appendDesktopProtoUint64(out, 4, memory.SwapTotalBytes)
	return out
}

func encodeDesktopMonitorNetworkProto(network desktopGatewayNetworkRate) []byte {
	var out []byte
	out = appendDesktopProtoUint64(out, 1, network.bytesRecvPerSec)
	out = appendDesktopProtoUint64(out, 2, network.bytesSentPerSec)
	return out
}

func encodeDesktopMonitorDiskProto(disk DesktopMonitorDiskInfo) []byte {
	var out []byte
	out = appendDesktopProtoString(out, 1, disk.MountPoint)
	out = appendDesktopProtoUint64(out, 2, disk.UsedBytes)
	out = appendDesktopProtoUint64(out, 3, disk.TotalBytes)
	return out
}

func encodeDesktopMonitorDockerProto(docker DesktopMonitorDockerInfo) []byte {
	var out []byte
	out = appendDesktopProtoUint32(out, 1, uint32(maxInt(0, docker.ContainersRunning)))
	out = appendDesktopProtoUint32(out, 2, uint32(maxInt(0, docker.ContainersTotal)))
	out = appendDesktopProtoBool(out, 3, docker.DockerInstalled)
	return out
}

func appendDesktopProtoTag(dst []byte, fieldNumber int, wireType int) []byte {
	return appendDesktopProtoVarint(dst, uint64(fieldNumber<<3|wireType))
}

func appendDesktopProtoVarint(dst []byte, value uint64) []byte {
	for value >= 0x80 {
		dst = append(dst, byte(value)|0x80)
		value >>= 7
	}
	return append(dst, byte(value))
}

func appendDesktopProtoBytes(dst []byte, fieldNumber int, value []byte) []byte {
	if len(value) == 0 {
		return dst
	}
	dst = appendDesktopProtoTag(dst, fieldNumber, desktopProtoWireBytes)
	dst = appendDesktopProtoVarint(dst, uint64(len(value)))
	return append(dst, value...)
}

func appendDesktopProtoMessage(dst []byte, fieldNumber int, value []byte, includeEmpty bool) []byte {
	if len(value) == 0 && !includeEmpty {
		return dst
	}
	dst = appendDesktopProtoTag(dst, fieldNumber, desktopProtoWireBytes)
	dst = appendDesktopProtoVarint(dst, uint64(len(value)))
	return append(dst, value...)
}

func appendDesktopProtoString(dst []byte, fieldNumber int, value string) []byte {
	if value == "" {
		return dst
	}
	return appendDesktopProtoBytes(dst, fieldNumber, []byte(value))
}

func appendDesktopProtoUint64(dst []byte, fieldNumber int, value uint64) []byte {
	if value == 0 {
		return dst
	}
	dst = appendDesktopProtoTag(dst, fieldNumber, desktopProtoWireVarint)
	return appendDesktopProtoVarint(dst, value)
}

func appendDesktopProtoUint32(dst []byte, fieldNumber int, value uint32) []byte {
	return appendDesktopProtoUint64(dst, fieldNumber, uint64(value))
}

func appendDesktopProtoInt64(dst []byte, fieldNumber int, value int64) []byte {
	if value == 0 {
		return dst
	}
	dst = appendDesktopProtoTag(dst, fieldNumber, desktopProtoWireVarint)
	return appendDesktopProtoVarint(dst, uint64(value))
}

func appendDesktopProtoDouble(dst []byte, fieldNumber int, value float64) []byte {
	if value == 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return dst
	}
	dst = appendDesktopProtoTag(dst, fieldNumber, desktopProtoWireFixed64)
	var buffer [8]byte
	binary.LittleEndian.PutUint64(buffer[:], math.Float64bits(value))
	return append(dst, buffer[:]...)
}

func appendDesktopProtoBool(dst []byte, fieldNumber int, value bool) []byte {
	if !value {
		return dst
	}
	dst = appendDesktopProtoTag(dst, fieldNumber, desktopProtoWireVarint)
	return appendDesktopProtoVarint(dst, 1)
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
