import { useCallback, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AuthStatusResponse, User } from "@easyssh/app/lib/api/auth"
import { DEFAULT_SYSTEM_CONFIG, SystemConfigContextProvider } from "@easyssh/app/contexts/system-config-context"
import { authStatusQueryKey, authStatusQueryOptions } from "./auth-status-query"
import { ownerSession } from "./owner-session"

interface SystemConfigProviderProps {
  children: ReactNode
}

/** 认证状态与路由加载器共享缓存，刷新配置时保留已显示的内容。 */
export function SystemConfigProvider({ children }: SystemConfigProviderProps) {
  const queryClient = useQueryClient()
  const query = useQuery(authStatusQueryOptions())
  const authStatus = query.data ?? null
  const config = authStatus?.system_config ?? (query.isError ? DEFAULT_SYSTEM_CONFIG : null)

  const refreshConfig = async () => {
    await queryClient.fetchQuery({ ...authStatusQueryOptions(), staleTime: 0 })
  }

  const markLoggedOut = useCallback(() => {
    ownerSession.end()
    // 丢弃前一个账号的业务数据，也取消尚未完成的预取。
    void queryClient.cancelQueries()
    queryClient.removeQueries({ predicate: (entry) => entry.queryKey[0] !== authStatusQueryKey[0] })
    queryClient.setQueryData<AuthStatusResponse>(authStatusQueryKey, (current) => ({
      need_init: current?.need_init ?? false,
      is_authenticated: false,
      system_config: current?.system_config ?? DEFAULT_SYSTEM_CONFIG,
    }))
  }, [queryClient])

  const updateAuthUser = useCallback((user: User) => {
    queryClient.setQueryData<AuthStatusResponse>(authStatusQueryKey, (current) => (
      current?.is_authenticated ? { ...current, user } : current
    ))
  }, [queryClient])

  return (
    <SystemConfigContextProvider value={{ config, isLoading: query.isPending, error: query.error, refreshConfig, markLoggedOut, updateAuthUser, authStatus }}>
      {children}
    </SystemConfigContextProvider>
  )
}
