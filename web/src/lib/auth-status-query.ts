import { queryOptions } from "@tanstack/react-query"
import { authApi, type AuthStatusResponse } from "@/lib/api/auth"
import { useAuthStore } from "@/stores/auth-store"

export const authStatusQueryKey = ["auth-status"] as const

export function shouldRestoreAuthSession(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/dashboard" || pathname.startsWith("/dashboard/")
}

// 路由和 Provider 共用 Query 的缓存及进行中的请求，避免重复恢复会话。
export function authStatusQueryOptions(refresh: boolean) {
  return queryOptions({
    queryKey: authStatusQueryKey,
    queryFn: async ({ client }) => {
      const status = await authApi.checkStatus({ refresh })
      if (!status.is_authenticated) useAuthStore.getState().clearToken()
      if (!status.system_config) throw new Error("system_config is missing in /auth/status response")
      const previous = client.getQueryData<AuthStatusResponse>(authStatusQueryKey)
      if (previous?.user?.id !== status.user?.id) {
        const otherQueries = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== authStatusQueryKey[0] }
        await client.cancelQueries(otherQueries)
        client.removeQueries(otherQueries)
      }
      return status
    },
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
