import { apiFetch } from "@/lib/api-client"

/**
 * 顶部统计卡片数据块
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
}

/**
 * 仪表盘最近连接服务器（仅包含首页展示所需字段）
 */
export interface OverviewRecentServer {
  id: string
  name: string
  host: string
  port: number
  username: string
  group: string
  status: "online" | "offline"
  country: string
  city: string
  last_connected?: string
}

/**
 * 仪表盘聚合概览响应
 */
export interface DashboardOverview {
  stats: OverviewStatsBlock
  distribution: OverviewRegionCount[]
  recent_servers: OverviewRecentServer[]
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
