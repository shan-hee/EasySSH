import { queryOptions } from "@tanstack/react-query"
import type { AuthStatusResponse } from "@easyssh/app/lib/api/auth"
import { authSession } from "./auth-session"

export const authStatusQueryKey = ["auth-status"] as const

// 路由和 Provider 共用 Query 的缓存及进行中的请求。
export function authStatusQueryOptions() {
  return queryOptions({
    queryKey: authStatusQueryKey,
    queryFn: async ({ client }) => {
      const status = await authSession.checkStatus()
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
