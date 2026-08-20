import { createElement, type ComponentType } from "react"
import type { QueryClient } from "@tanstack/react-query"

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
} from "@/lib/dashboard-query-options"

type DashboardPageModule = { default: ComponentType }

interface DashboardRouteDefinitionBase {
  url: string
  idlePreload?: boolean
  load: () => Promise<DashboardPageModule>
  prefetchData?: (queryClient: QueryClient, url: string) => Promise<unknown>
}

type DashboardRouteLocation =
  | { index: true; path?: never }
  | { index?: false; path: string }

type DashboardRouteDefinitionInput = DashboardRouteDefinitionBase & DashboardRouteLocation

export type DashboardRouteDefinition = DashboardRouteDefinitionInput & {
  Page: ComponentType
}

function defineDashboardRoute(
  definition: DashboardRouteDefinitionInput,
): DashboardRouteDefinition {
  let loadPromise: Promise<DashboardPageModule> | undefined
  let loadedPage: ComponentType | undefined
  let loadError: unknown
  const load = () => {
    if (loadError) return Promise.reject(loadError)
    if (!loadPromise) {
      loadPromise = definition.load()
        .then((module) => {
          loadedPage = module.default
          return module
        })
        .catch((error) => {
          loadError = error
          throw error
        })
    }
    return loadPromise
  }
  const Page = () => {
    if (loadError) throw loadError
    if (!loadedPage) throw load()
    return createElement(loadedPage)
  }

  return {
    ...definition,
    load,
    Page,
  }
}

function getSearchParams(url: string) {
  const query = url.split("?", 2)[1]
  return new URLSearchParams(query ?? "")
}

export const dashboardRouteRegistry: readonly DashboardRouteDefinition[] = [
  defineDashboardRoute({
    url: "/dashboard",
    index: true,
    load: () => import("@/pages/dashboard/overview-page"),
    prefetchData: (queryClient) => queryClient.prefetchQuery(dashboardOverviewQueryOptions()),
  }),
  defineDashboardRoute({
    url: "/dashboard/terminal",
    path: "terminal",
    load: () => import("@/pages/dashboard/terminal-page"),
  }),
  defineDashboardRoute({
    url: "/dashboard/ai-assistant",
    path: "ai-assistant",
    load: () => import("@/pages/dashboard/ai-assistant-page"),
  }),
  defineDashboardRoute({
    url: "/dashboard/users",
    path: "users",
    idlePreload: true,
    load: () => import("@/pages/dashboard/users-page"),
  }),
  defineDashboardRoute({
    url: "/dashboard/logs",
    path: "logs",
    idlePreload: true,
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
    path: "operation-logs",
    idlePreload: true,
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
    path: "scripts",
    load: () => import("@/components/dashboard/scripts/scripts-page"),
    prefetchData: (queryClient) => queryClient.prefetchQuery(scriptsListQueryOptions()),
  }),
  defineDashboardRoute({
    url: "/dashboard/tasks",
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
    path: "settings",
    idlePreload: true,
    load: () => import("@/pages/dashboard/settings-page"),
    prefetchData: (queryClient, url) => {
      const section = getSearchParams(url).get("section") || "basic"
      return section === "basic"
        ? queryClient.prefetchQuery(systemBasicSettingsQueryOptions())
        : Promise.resolve()
    },
  }),
  defineDashboardRoute({
    url: "/dashboard/settings/management",
    path: "settings/management",
    load: () => import("@/pages/dashboard/settings-management-page"),
  }),
]

const routeByUrl = new Map(
  dashboardRouteRegistry.map((route) => [route.url, route]),
)

export function getDashboardRouteDefinition(url: string) {
  return routeByUrl.get(url.split("?", 1)[0])
}
