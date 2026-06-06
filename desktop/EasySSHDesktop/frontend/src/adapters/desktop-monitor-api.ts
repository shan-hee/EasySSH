import type { WorkspaceMonitorApi, WorkspaceMonitorMetrics } from "@easyssh/ssh-workspace/desktop"
import { DesktopMonitorService } from "../../bindings/github.com/easyssh/easyssh-desktop"

type DesktopMonitorSnapshot = Awaited<ReturnType<typeof DesktopMonitorService.Collect>>

const previousSnapshots = new Map<string, DesktopMonitorSnapshot>()

export function createDesktopMonitorApi(): WorkspaceMonitorApi {
  return {
    async collectMetrics(serverId, options) {
      const snapshot = await DesktopMonitorService.Collect({
        serverId,
        timeoutMs: Math.max(15000, Math.round((options?.intervalSeconds ?? 2) * 1000) + 10000),
      })
      const previous = previousSnapshots.get(serverId)
      previousSnapshots.set(serverId, snapshot)

      return mapDesktopMonitorSnapshot(snapshot, previous)
    },
  }
}

function mapDesktopMonitorSnapshot(
  snapshot: DesktopMonitorSnapshot,
  previous?: DesktopMonitorSnapshot,
): WorkspaceMonitorMetrics {
  const disks = (snapshot.disks || []).map((disk) => ({
    mountPoint: disk.mountPoint || "-",
    usedBytes: toNumber(disk.usedBytes),
    totalBytes: toNumber(disk.totalBytes),
  }))

  const diskTotalBytes = disks.reduce((sum, disk) => sum + disk.totalBytes, 0)
  const diskUsedBytes = disks.reduce((sum, disk) => sum + disk.usedBytes, 0)
  const timestamp = toNumber(snapshot.timestamp) || Math.floor(Date.now() / 1000)

  return {
    systemInfo: {
      os: snapshot.systemInfo?.os || "Linux",
      hostname: snapshot.systemInfo?.hostname || "-",
      cpuModel: snapshot.systemInfo?.cpuModel || "-",
      arch: snapshot.systemInfo?.arch || "-",
      loadAvg: snapshot.systemInfo?.loadAvg || "-",
      uptimeSeconds: toNumber(snapshot.systemInfo?.uptimeSeconds),
      cpuCores: toNumber(snapshot.systemInfo?.cpuCores) || toNumber(snapshot.cpu?.coreCount),
    },
    cpu: {
      usagePercent: calculateCpuUsage(snapshot, previous),
      coreCount: toNumber(snapshot.cpu?.coreCount) || toNumber(snapshot.systemInfo?.cpuCores),
    },
    memory: {
      ramUsedBytes: toNumber(snapshot.memory?.ramUsedBytes),
      ramTotalBytes: toNumber(snapshot.memory?.ramTotalBytes),
      swapUsedBytes: toNumber(snapshot.memory?.swapUsedBytes),
      swapTotalBytes: toNumber(snapshot.memory?.swapTotalBytes),
    },
    network: calculateNetworkRate(snapshot, previous),
    disks,
    diskTotalPercent: diskTotalBytes > 0 ? (diskUsedBytes / diskTotalBytes) * 100 : 0,
    sshLatencyMs: toNumber(snapshot.sshLatencyMs),
    timestamp,
    docker: {
      containersRunning: toNumber(snapshot.docker?.containersRunning),
      containersTotal: toNumber(snapshot.docker?.containersTotal),
      dockerInstalled: Boolean(snapshot.docker?.dockerInstalled),
    },
  }
}

function calculateCpuUsage(snapshot: DesktopMonitorSnapshot, previous?: DesktopMonitorSnapshot) {
  const currentIdle = toNumber(snapshot.cpu?.idleTicks)
  const currentTotal = toNumber(snapshot.cpu?.totalTicks)
  if (!previous) {
    return clampPercent(toNumber(snapshot.cpu?.usagePercent))
  }

  const idleDelta = currentIdle - toNumber(previous.cpu?.idleTicks)
  const totalDelta = currentTotal - toNumber(previous.cpu?.totalTicks)
  if (totalDelta <= 0 || idleDelta < 0) {
    return clampPercent(toNumber(snapshot.cpu?.usagePercent))
  }

  return clampPercent((1 - idleDelta / totalDelta) * 100)
}

function calculateNetworkRate(snapshot: DesktopMonitorSnapshot, previous?: DesktopMonitorSnapshot) {
  if (!previous) {
    return {
      bytesRecvPerSec: 0,
      bytesSentPerSec: 0,
    }
  }

  const elapsedSeconds = Math.max(1, toNumber(snapshot.timestamp) - toNumber(previous.timestamp))
  const recvDelta = toNumber(snapshot.network?.bytesRecvTotal) - toNumber(previous.network?.bytesRecvTotal)
  const sentDelta = toNumber(snapshot.network?.bytesSentTotal) - toNumber(previous.network?.bytesSentTotal)

  return {
    bytesRecvPerSec: Math.max(0, Math.round(recvDelta / elapsedSeconds)),
    bytesSentPerSec: Math.max(0, Math.round(sentDelta / elapsedSeconds)),
  }
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
