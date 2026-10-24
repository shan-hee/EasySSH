import type { QueryClient } from "@tanstack/react-query"
import { redirect, type LoaderFunctionArgs } from "react-router-dom"
import type { DashboardRouteDefinition } from "@/lib/dashboard-route-registry"
import { authStatusQueryOptions } from "@/lib/auth-status-query"
import { getAuthRedirectDecision } from "@/lib/auth-redirect"
import { runtimeInfoQueryOptions } from "@/shell/runtime/use-runtime-info"
import { getRouteFallback, isRouteAllowed } from "@/shell/navigation/route-policy"

export async function requireDashboardAccess(queryClient: QueryClient, request: Request) {
  const url = new URL(request.url)
  const status = await queryClient.fetchQuery(authStatusQueryOptions(true))
  request.signal.throwIfAborted()
  const decision = getAuthRedirectDecision("dashboard", status, { currentPath: `${url.pathname}${url.search}${url.hash}` })
  if (decision.type === "redirect") throw redirect(decision.href)

  const runtime = await queryClient.ensureQueryData(runtimeInfoQueryOptions())
  request.signal.throwIfAborted()
  const permissions = status.user?.permissions ?? []
  const isOwner = runtime.principal.role === "owner"
  if (!isRouteAllowed(runtime, url.pathname, permissions, isOwner)) {
    throw redirect(getRouteFallback(url.pathname, runtime, permissions, isOwner))
  }
}

export function createDashboardPageLoader(queryClient: QueryClient, route: DashboardRouteDefinition) {
  return async ({ request }: LoaderFunctionArgs) => {
    // 父子 loader 并行执行；每个业务 loader 必须先经过同一个鉴权入口。
    await requireDashboardAccess(queryClient, request)
    const url = new URL(request.url)
    const destination = `${url.pathname}${url.search}`
    await Promise.all([route.preloadContent?.(destination), route.loadData?.(queryClient, destination)])
    request.signal.throwIfAborted()
    return null
  }
}
