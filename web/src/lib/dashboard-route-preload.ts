import type { QueryClient } from "@tanstack/react-query"

import { getDashboardRouteDefinition } from "@/lib/dashboard-route-registry"

type NetworkInformation = {
  saveData?: boolean
  effectiveType?: string
  downlink?: number
  rtt?: number
}

export function preloadDashboardRoute(url: string, queryClient?: QueryClient) {
  // CPU 空闲不代表网络空闲；弱网下让带宽优先用于当前页面。
  const connection = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (connection?.saveData ||
    (connection?.effectiveType && connection.effectiveType !== "4g") ||
    (connection?.downlink !== undefined && connection.downlink < 1.5) ||
    (connection?.rtt !== undefined && connection.rtt > 300)) {
    return Promise.resolve()
  }

  const route = getDashboardRouteDefinition(url)
  if (!route) {
    return Promise.resolve()
  }

  const dataPreload = queryClient && route.prefetchData
    ? route.prefetchData(queryClient, url)
    : Promise.resolve()

  return Promise.allSettled([route.load(), dataPreload]).then(() => undefined)
}
