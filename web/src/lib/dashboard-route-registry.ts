import type { ComponentType } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { getSettingsSection } from "@/lib/settings-section-registry"

import {
  auditLogsQueryOptions,
  dashboardOverviewQueryOptions,
  defaultAuditLogListParams,
  defaultOperationRecordListParams,
  operationRecordsQueryOptions,
  scriptsListQueryOptions,
  systemBasicSettingsQueryOptions,
  taskCenterRunsQueryOptions,
  taskCenterStatisticsQueryOptions,
  userAdministrationQueryOptions,
} from "@/lib/dashboard-query-options"

type DashboardPageModule = { default: ComponentType }

interface DashboardRouteDefinitionBase {
  url: string
  load: () => Promise<DashboardPageModule>
  namespaces: string[]
  preloadContent?: (url: string) => Promise<unknown>
  loadData?: (queryClient: QueryClient, url: string) => Promise<unknown>
}

type DashboardRouteLocation =
  | { index: true; path?: never }
  | { index?: false; path: string }

export type DashboardRouteDefinition = DashboardRouteDefinitionBase & DashboardRouteLocation

function getSearchParams(url: string) {
  const query = url.split("?", 2)[1]
  return new URLSearchParams(query ?? "")
}

export const dashboardRouteRegistry: readonly DashboardRouteDefinition[] = [
  {
    url: "/dashboard",
    namespaces: ["dashboard"],
    index: true,
    load: () => import("@/pages/dashboard/overview-page"),
    loadData: (queryClient) => queryClient.ensureQueryData({ ...dashboardOverviewQueryOptions(), revalidateIfStale: true }),
  },
  {
    url: "/dashboard/terminal",
    namespaces: ["terminal", "servers", "sftp", "terminalSettings"],
    path: "terminal",
    load: () => import("@/pages/dashboard/terminal-page"),
  },
  {
    url: "/dashboard/ai-assistant",
    namespaces: ["aiAssistant"],
    path: "ai-assistant",
    load: () => import("@/pages/dashboard/ai-assistant-page"),
  },
  {
    url: "/dashboard/users",
    namespaces: ["users"],
    path: "users",
    load: () => import("@/pages/dashboard/users-page"),
    loadData: (queryClient) => queryClient.ensureQueryData({ ...userAdministrationQueryOptions(), revalidateIfStale: true }),
  },
  {
    url: "/dashboard/logs",
    namespaces: ["logsAudit"],
    path: "logs",
    load: () => import("@/pages/dashboard/logs-page"),
    loadData: (queryClient, url) => {
      const action = getSearchParams(url).get("action") || undefined
      return queryClient.ensureQueryData({ ...auditLogsQueryOptions({
        ...defaultAuditLogListParams,
        action,
      }), revalidateIfStale: true })
    },
  },
  {
    url: "/dashboard/operation-logs",
    namespaces: ["operationLogs"],
    path: "operation-logs",
    load: () => import("@/pages/dashboard/operation-logs-page"),
    loadData: (queryClient, url) => {
      const type = getSearchParams(url).get("type")
      const validType = type === "connection" || type === "transfer" || type === "execution" || type === "audit"
        ? type
        : undefined
      return queryClient.ensureQueryData({ ...operationRecordsQueryOptions({
        ...defaultOperationRecordListParams,
        type: validType ? [validType] : undefined,
      }), revalidateIfStale: true })
    },
  },
  {
    url: "/dashboard/scripts",
    namespaces: ["scripts"],
    path: "scripts",
    load: () => import("@/components/dashboard/scripts/scripts-page"),
    loadData: (queryClient) => queryClient.ensureQueryData({ ...scriptsListQueryOptions(), revalidateIfStale: true }),
  },
  {
    url: "/dashboard/tasks",
    namespaces: ["taskCenter"],
    path: "tasks",
    load: () => import("@/pages/dashboard/task-center-page"),
    loadData: async (queryClient) => {
      await Promise.all([
        queryClient.ensureQueryData({ ...taskCenterRunsQueryOptions(), revalidateIfStale: true }),
        queryClient.ensureQueryData({ ...taskCenterStatisticsQueryOptions(), revalidateIfStale: true }),
      ])
    },
  },
  {
    url: "/dashboard/settings",
    namespaces: ["settingsMain"],
    path: "settings",
    load: () => import("@/pages/dashboard/settings-page"),
    preloadContent: (url) => getSettingsSection(url).preload(),
    loadData: (queryClient, url) => {
      const section = getSearchParams(url).get("section") || "basic"
      return section === "basic"
        ? queryClient.ensureQueryData({ ...systemBasicSettingsQueryOptions(), revalidateIfStale: true })
        : Promise.resolve()
    },
  },
  {
    url: "/dashboard/settings/management",
    namespaces: ["settingsManagement", "users"],
    path: "settings/management",
    load: () => import("@/pages/dashboard/settings-management-page"),
    loadData: (queryClient) => queryClient.ensureQueryData({ ...userAdministrationQueryOptions(), revalidateIfStale: true }),
  },
]

const routeByUrl = new Map(
  dashboardRouteRegistry.map((route) => [route.url, route]),
)

export function getDashboardRouteDefinition(url: string) {
  return routeByUrl.get(url.split("?", 1)[0])
}
