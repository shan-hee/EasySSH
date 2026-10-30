import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

export type DashboardOverview = components["schemas"]["DashboardOverview"]
export type OverviewRegionCount = components["schemas"]["DashboardRegionCount"]
export type OverviewRegionServer = components["schemas"]["DashboardRegionServer"]

/** 浏览器所在时区；“今日”的活动统计按该时区划分。 */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/**
 * 获取仪表盘聚合概览：连接统计、区域分布与当天的活动汇总。
 */
async function getOverview(timezone = localTimezone()): Promise<DashboardOverview> {
  return apiFetch<DashboardOverview>(`/dashboard/overview?timezone=${encodeURIComponent(timezone)}`)
}

/**
 * Dashboard API 客户端
 */
export const dashboardApi = {
  getOverview,
}
