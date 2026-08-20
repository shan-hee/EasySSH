import { apiFetch } from "@/lib/api-client"

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
    return apiFetch<AllServersResourcesResponse>(`/monitoring/resources`)
  },
}
