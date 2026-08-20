import type { QueryClient } from "@tanstack/react-query"

import {
  dashboardRouteRegistry,
  getDashboardRouteDefinition,
} from "@/lib/dashboard-route-registry"

export function preloadDashboardRoute(url: string, queryClient?: QueryClient) {
  const route = getDashboardRouteDefinition(url)
  if (!route) {
    return Promise.resolve()
  }

  const dataPreload = queryClient && route.prefetchData
    ? route.prefetchData(queryClient, url)
    : Promise.resolve()

  return Promise.allSettled([route.load(), dataPreload]).then(() => undefined)
}

export function preloadCommonDashboardRoutes(availableRoutes: readonly string[]) {
  const available = new Set(availableRoutes.map((route) => route.split("?", 1)[0]))

  dashboardRouteRegistry
    .filter((route) => route.idlePreload && available.has(route.url))
    .forEach((route) => {
      void preloadDashboardRoute(route.url)
    })
}
