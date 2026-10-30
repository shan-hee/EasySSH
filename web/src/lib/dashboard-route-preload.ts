import { authStatusQueryKey } from "../platform/auth-status-query"
import type { AuthStatusResponse } from "@easyssh/app/lib/api/auth"
import { runtimeInfoQueryKey } from "@easyssh/app/shell/runtime/use-runtime-info"
import type { RuntimeInfo } from "@easyssh/app/shell/runtime/types"
import { isRouteAllowed } from "@easyssh/app/shell/navigation/route-policy"
import { preloadNamespaces } from "@easyssh/app/i18n"
import type { QueryClient } from "@tanstack/react-query"

import { getDashboardRouteDefinition } from "./dashboard-route-registry"

type NetworkInformation = {
  saveData?: boolean
  effectiveType?: string
  downlink?: number
  rtt?: number
}

export function preloadDashboardRoute(url: string, queryClient?: QueryClient, intent: "hover" | "navigation" = "hover") {
  // Only speculative work yields on slow networks; an actual navigation starts immediately.
  const connection = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (intent === "hover" && (connection?.saveData ||
    (connection?.effectiveType && connection.effectiveType !== "4g") ||
    (connection?.downlink !== undefined && connection.downlink < 1.5) ||
    (connection?.rtt !== undefined && connection.rtt > 300))) {
    return Promise.resolve()
  }

  const route = getDashboardRouteDefinition(url)
  if (!route) {
    return Promise.resolve()
  }

  const auth = queryClient?.getQueryData<AuthStatusResponse>(authStatusQueryKey)
  const runtime = queryClient?.getQueryData<RuntimeInfo>(runtimeInfoQueryKey)
  const allowed = auth?.is_authenticated && runtime && isRouteAllowed(runtime, route.url)
  const dataPreload = allowed && queryClient && route.loadData
    ? route.loadData(queryClient, url)
    : Promise.resolve()

  return Promise.allSettled([route.load(), preloadNamespaces(["common", ...route.namespaces]), route.preloadContent?.(url), dataPreload]).then(() => undefined)
}
