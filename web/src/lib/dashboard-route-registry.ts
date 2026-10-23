import { createElement, type ComponentType } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { createRetryableLoader } from "@/lib/retryable-loader"
import { preloadNamespaces } from "@/i18n"
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
  prefetchData?: (queryClient: QueryClient, url: string) => Promise<unknown>
}

type DashboardRouteLocation =
  | { index: true; path?: never }
  | { index?: false; path: string }

type DashboardRouteDefinitionInput = DashboardRouteDefinitionBase & DashboardRouteLocation

export type DashboardRouteDefinition = DashboardRouteDefinitionInput & {
  Page: ComponentType
  reset: () => void
}

function defineDashboardRoute(
  definition: DashboardRouteDefinitionInput,
): DashboardRouteDefinition {
  const resource = createRetryableLoader(async () => {
    const [module] = await Promise.all([
      definition.load(),
      preloadNamespaces(["common", ...definition.namespaces]),
    ])
    return module
  })
  const load = async () => {
    await resource.load()
    return resource.read()
  }
  const Page = () => {
    return createElement(resource.read().default)
  }

  return {
    ...definition,
    load,
    Page,
    reset: resource.reset,
  }
}

function getSearchParams(url: string) {
  const query = url.split("?", 2)[1]
  return new URLSearchParams(query ?? "")
}

export const dashboardRouteRegistry: readonly DashboardRouteDefinition[] = [
  defineDashboardRoute({
    url: "/dashboard",
    namespaces: ["dashboard"],
    index: true,
    load: () => import("@/pages/dashboard/overview-page"),
    prefetchData: (queryClient) => queryClient.prefetchQuery(dashboardOverviewQueryOptions()),
  }),
  defineDashboardRoute({
    url: "/dashboard/terminal",
    namespaces: ["terminal", "servers", "sftp", "terminalSettings"],
    path: "terminal",
    load: () => import("@/pages/dashboard/terminal-page"),
  }),
  defineDashboardRoute({
    url: "/dashboard/ai-assistant",
    namespaces: ["aiAssistant"],
    path: "ai-assistant",
    load: () => import("@/pages/dashboard/ai-assistant-page"),
  }),
  defineDashboardRoute({
    url: "/dashboard/users",
    namespaces: ["users"],
    path: "users",
    load: () => import("@/pages/dashboard/users-page"),
    prefetchData: (queryClient) => queryClient.prefetchQuery(userAdministrationQueryOptions()),
  }),
  defineDashboardRoute({
    url: "/dashboard/logs",
    namespaces: ["logsAudit"],
    path: "logs",
    load: () => import("@/pages/dashboard/logs-page"),
    prefetchData: (queryClient, url) => {
      const action = getSearchParams(url).get("action") || undefined
      return queryClient.prefetchQuery(auditLogsQueryOptions({
        ...defaultAuditLogListParams,
        action,
      }))
    },
  }),
  defineDashboardRoute({
    url: "/dashboard/operation-logs",
    namespaces: ["operationLogs"],
    path: "operation-logs",
    load: () => import("@/pages/dashboard/operation-logs-page"),
    prefetchData: (queryClient, url) => {
      const type = getSearchParams(url).get("type")
      const validType = type === "connection" || type === "transfer" || type === "execution" || type === "audit"
        ? type
        : undefined
      return queryClient.prefetchQuery(operationRecordsQueryOptions({
        ...defaultOperationRecordListParams,
        type: validType ? [validType] : undefined,
      }))
    },
  }),
  defineDashboardRoute({
    url: "/dashboard/scripts",
    namespaces: ["scripts"],
    path: "scripts",
    load: () => import("@/components/dashboard/scripts/scripts-page"),
    prefetchData: (queryClient) => queryClient.prefetchQuery(scriptsListQueryOptions()),
  }),
  defineDashboardRoute({
    url: "/dashboard/tasks",
    namespaces: ["taskCenter"],
    path: "tasks",
    load: () => import("@/pages/dashboard/task-center-page"),
    prefetchData: async (queryClient) => {
      await Promise.all([
        queryClient.prefetchQuery(taskCenterRunsQueryOptions()),
        queryClient.prefetchQuery(taskCenterStatisticsQueryOptions()),
      ])
    },
  }),
  defineDashboardRoute({
    url: "/dashboard/settings",
    namespaces: ["settingsMain"],
    path: "settings",
    load: () => import("@/pages/dashboard/settings-page"),
    preloadContent: (url) => getSettingsSection(url).preload(),
    prefetchData: (queryClient, url) => {
      const section = getSearchParams(url).get("section") || "basic"
      return section === "basic"
        ? queryClient.prefetchQuery(systemBasicSettingsQueryOptions())
        : Promise.resolve()
    },
  }),
  defineDashboardRoute({
    url: "/dashboard/settings/management",
    namespaces: ["settingsManagement", "users"],
    path: "settings/management",
    load: () => import("@/pages/dashboard/settings-management-page"),
    prefetchData: (queryClient) => queryClient.prefetchQuery(userAdministrationQueryOptions()),
  }),
]

const routeByUrl = new Map(
  dashboardRouteRegistry.map((route) => [route.url, route]),
)

export function getDashboardRouteDefinition(url: string) {
  return routeByUrl.get(url.split("?", 1)[0])
}
