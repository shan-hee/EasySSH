import { serversApi } from "./servers"
import { connectedSSH } from "@/lib/secure-runtime/terminal"
import type { WorkspaceMonitorMetrics } from "@/lib/session/workspace"

/**
 * CPU 概览
 */
export interface CPUSummary {
  cores: number
  usage_percent: number
  load_average: number[]
}

/**
 * 内存概览
 */
export interface MemorySummary {
  total: number
  used: number
  used_percent: number
}

/**
 * 磁盘概览
 */
export interface DiskSummary {
  total: number
  used: number
  used_percent: number
}

/**
 * 网络概览
 */
export interface NetworkSummary {
  rx_bytes: number
  tx_bytes: number
}

/**
 * 地理位置概览
 */
export interface LocationSummary {
  country: string
  country_code: string
  region: string
  city: string
}

/**
 * 单台服务器资源概览
 */
export interface ServerResourceSummary {
  server_id: string
  name: string
  host: string
  port: number
  status: "online" | "offline" | "error"
  location?: LocationSummary | null
  cpu: CPUSummary | null
  memory: MemorySummary | null
  disk: DiskSummary | null
  network: NetworkSummary | null
  uptime: number
  collected_at: string
  error?: string
}

/**
 * 所有服务器资源概览响应
 */
export interface AllServersResourcesResponse {
  servers: ServerResourceSummary[]
  collected_at: string
}

/**
 * 监控 API 服务
 */
export const monitoringApi = {
  /**
   * 获取所有服务器的资源概览（单次请求，批量采集）
   */
  async getAllServersResources(): Promise<AllServersResourcesResponse> {
    const servers: ServerResourceSummary[] = []
    const rows = (await serversApi.list({ limit: 10000 })).data
    for (const server of rows) {
      const base: ServerResourceSummary = { server_id: server.id, name: server.name || server.host, host: server.host, port: server.port, status: "offline", cpu: null, memory: null, disk: null, network: null, uptime: 0, collected_at: new Date().toISOString() }
      try {
        const m = await connectedSSH(server.id).request<WorkspaceMonitorMetrics>("metrics")
        const total = m.disks.reduce((n, d) => n + d.totalBytes, 0), used = m.disks.reduce((n, d) => n + d.usedBytes, 0)
        Object.assign(base, { status: "online", cpu: { cores: m.cpu.coreCount, usage_percent: m.cpu.usagePercent, load_average: m.systemInfo.loadAvg.split(/\s+/).map(Number) },
          memory: { total: m.memory.ramTotalBytes, used: m.memory.ramUsedBytes, used_percent: m.memory.ramTotalBytes ? 100 * m.memory.ramUsedBytes / m.memory.ramTotalBytes : 0 },
          disk: { total, used, used_percent: m.diskTotalPercent }, network: { rx_bytes: m.network.bytesRecvPerSec, tx_bytes: m.network.bytesSentPerSec }, uptime: m.systemInfo.uptimeSeconds })
      } catch (e) { base.error = e instanceof Error ? e.message : String(e) }
      servers.push(base)
    }
    return { servers, collected_at: new Date().toISOString() }
  },
}
