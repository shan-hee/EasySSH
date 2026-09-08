import { apiFetch } from "@/lib/api-client"

/**
 * 统计卡片数据块
 */
export interface OverviewStatsBlock {
  online_servers: number
  total_servers: number
  active_sessions: number
  today_commands: number
}

/**
 * 服务器区域分布项
 */
export interface OverviewRegionCount {
  region: string
  country_code: string
  count: number
  servers: OverviewRegionServer[]
}

/**
 * 地区服务器列表（仅包含展示与连接入口所需字段）
 */
export interface OverviewRegionServer {
  id: string
  name: string
  host: string
  port: number
  username: string
  status: "online" | "offline"
}

/**
 * 仪表盘聚合概览响应
 */
export interface DashboardOverview {
  stats: OverviewStatsBlock
  distribution: OverviewRegionCount[]
}

/**
 * 获取仪表盘聚合概览（实时指标 + 区域分布）
 */
async function getOverview(): Promise<DashboardOverview> {
  return apiFetch<DashboardOverview>("/dashboard/overview")
}

/**
 * Dashboard API 客户端
 */
export const dashboardApi = {
  getOverview,
}
