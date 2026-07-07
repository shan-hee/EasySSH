import type { WorkspaceMonitorApi, WorkspaceMonitorMetrics } from "@easyssh/ssh-workspace/desktop"
import { DesktopMonitorService } from "../../bindings/github.com/easyssh/easyssh-desktop"
import type { DesktopGatewayInfo } from "./desktop-runtime"
import { toFiniteNumber } from "./desktop-adapter-utils"

type DesktopMonitorSnapshot = Awaited<ReturnType<typeof DesktopMonitorService.Collect>>

const previousSnapshots = new Map<string, DesktopMonitorSnapshot>()

export function createDesktopMonitorApi(gateway?: DesktopGatewayInfo): WorkspaceMonitorApi {
  const api: WorkspaceMonitorApi = {
    async collectMetrics(serverId, options) {
      const snapshot = await DesktopMonitorService.Collect({
        serverId,
        timeoutMs: Math.max(15000, Math.round((options?.intervalSeconds ?? 2) * 1000) + 10000),
      })
      const previous = previousSnapshots.get(serverId)
      previousSnapshots.set(serverId, snapshot)

      return mapDesktopMonitorSnapshot(snapshot, previous)
    }
  }

  if (gateway?.wsBaseUrl && gateway.token) {
    api.createAuthTicket = async () => gateway.token ?? "desktop"
    api.createWebSocketUrl = ({ serverId, interval, ticket }) => {
      const params = new URLSearchParams()
      params.set("serverId", serverId)
      params.set("interval", String(interval))
      params.set("ticket", ticket)
      return `${gateway.wsBaseUrl}/monitor?${params.toString()}`
    }
  }

  return api
}

function mapDesktopMonitorSnapshot(
  snapshot: DesktopMonitorSnapshot,
  previous?: DesktopMonitorSnapshot,
): WorkspaceMonitorMetrics {
  const disks = (snapshot.disks || []).map((disk) => ({
    mountPoint: disk.mountPoint || "-",
    usedBytes: toFiniteNumber(disk.usedBytes),
    totalBytes: toFiniteNumber(disk.totalBytes),
  }))

  const diskTotalBytes = disks.reduce((sum, disk) => sum + disk.totalBytes, 0)
  const diskUsedBytes = disks.reduce((sum, disk) => sum + disk.usedBytes, 0)
  const timestamp = toFiniteNumber(snapshot.timestamp) || Math.floor(Date.now() / 1000)

  return {
    systemInfo: {
      os: snapshot.systemInfo?.os || "Linux",
      hostname: snapshot.systemInfo?.hostname || "-",
      cpuModel: snapshot.systemInfo?.cpuModel || "-",
      arch: snapshot.systemInfo?.arch || "-",
      loadAvg: snapshot.systemInfo?.loadAvg || "-",
      uptimeSeconds: toFiniteNumber(snapshot.systemInfo?.uptimeSeconds),
      cpuCores: toFiniteNumber(snapshot.systemInfo?.cpuCores) || toFiniteNumber(snapshot.cpu?.coreCount),
    },
    cpu: {
      usagePercent: calculateCpuUsage(snapshot, previous),
      coreCount: toFiniteNumber(snapshot.cpu?.coreCount) || toFiniteNumber(snapshot.systemInfo?.cpuCores),
    },
    memory: {
      ramUsedBytes: toFiniteNumber(snapshot.memory?.ramUsedBytes),
      ramTotalBytes: toFiniteNumber(snapshot.memory?.ramTotalBytes),
      swapUsedBytes: toFiniteNumber(snapshot.memory?.swapUsedBytes),
      swapTotalBytes: toFiniteNumber(snapshot.memory?.swapTotalBytes),
    },
    network: calculateNetworkRate(snapshot, previous),
    disks,
    diskTotalPercent: diskTotalBytes > 0 ? (diskUsedBytes / diskTotalBytes) * 100 : 0,
    sshLatencyMs: toFiniteNumber(snapshot.sshLatencyMs),
    timestamp,
    docker: {
      containersRunning: toFiniteNumber(snapshot.docker?.containersRunning),
      containersTotal: toFiniteNumber(snapshot.docker?.containersTotal),
      dockerInstalled: Boolean(snapshot.docker?.dockerInstalled),
    },
  }
}

function calculateCpuUsage(snapshot: DesktopMonitorSnapshot, previous?: DesktopMonitorSnapshot) {
  const currentIdle = toFiniteNumber(snapshot.cpu?.idleTicks)
  const currentTotal = toFiniteNumber(snapshot.cpu?.totalTicks)
  if (!previous) {
    return clampPercent(toFiniteNumber(snapshot.cpu?.usagePercent))
  }

  const idleDelta = currentIdle - toFiniteNumber(previous.cpu?.idleTicks)
  const totalDelta = currentTotal - toFiniteNumber(previous.cpu?.totalTicks)
  if (totalDelta <= 0 || idleDelta < 0) {
    return clampPercent(toFiniteNumber(snapshot.cpu?.usagePercent))
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

  const elapsedSeconds = Math.max(1, getSnapshotElapsedSeconds(snapshot, previous))
  const recvDelta = toFiniteNumber(snapshot.network?.bytesRecvTotal) - toFiniteNumber(previous.network?.bytesRecvTotal)
  const sentDelta = toFiniteNumber(snapshot.network?.bytesSentTotal) - toFiniteNumber(previous.network?.bytesSentTotal)

  return {
    bytesRecvPerSec: Math.max(0, Math.round(recvDelta / elapsedSeconds)),
    bytesSentPerSec: Math.max(0, Math.round(sentDelta / elapsedSeconds)),
  }
}

function getSnapshotElapsedSeconds(snapshot: DesktopMonitorSnapshot, previous: DesktopMonitorSnapshot) {
  const currentCollectedAt = Date.parse(String(snapshot.collectedAt || ""))
  const previousCollectedAt = Date.parse(String(previous.collectedAt || ""))
  if (Number.isFinite(currentCollectedAt) && Number.isFinite(previousCollectedAt)) {
    const elapsedMs = currentCollectedAt - previousCollectedAt
    if (elapsedMs > 0) return elapsedMs / 1000
  }
  return toFiniteNumber(snapshot.timestamp) - toFiniteNumber(previous.timestamp)
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}
