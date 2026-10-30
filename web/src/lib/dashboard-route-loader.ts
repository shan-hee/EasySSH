import type { QueryClient } from "@tanstack/react-query"
import { redirect, type LoaderFunctionArgs } from "react-router-dom"
import type { DashboardRouteDefinition } from "./dashboard-route-registry"
import { authStatusQueryOptions } from "../platform/auth-status-query"
import { getAuthRedirectDecision } from "../platform/auth-redirect"
import { runtimeInfoQueryOptions } from "@easyssh/app/shell/runtime/use-runtime-info"
import { getRouteFallback, isRouteAllowed } from "@easyssh/app/shell/navigation/route-policy"

export async function requireDashboardAccess(queryClient: QueryClient, request: Request) {
  const url = new URL(request.url)
  const status = await queryClient.fetchQuery(authStatusQueryOptions())
  request.signal.throwIfAborted()
  const decision = getAuthRedirectDecision("dashboard", status, { currentPath: `${url.pathname}${url.search}${url.hash}` })
  if (decision.type === "redirect") throw redirect(decision.href)

  const runtime = await queryClient.ensureQueryData(runtimeInfoQueryOptions())
  request.signal.throwIfAborted()
  if (!isRouteAllowed(runtime, url.pathname)) {
    throw redirect(getRouteFallback(url.pathname, runtime))
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
