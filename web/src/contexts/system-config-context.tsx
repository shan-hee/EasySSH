
import { createContext, useCallback, useContext, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import type { SystemConfig } from "@/lib/api/settings"
import { type AuthStatusResponse, type User } from "@/lib/api/auth"
import {
  DEFAULT_BRAND_ICON,
  DEFAULT_BRAND_LOGO,
  DEFAULT_BRAND_NAME,
} from "@/lib/brand"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { authStatusQueryKey, authStatusQueryOptions, shouldRestoreAuthSession } from "@/lib/auth-status-query"

/**
 * 系统配置 Context
 * 提供全局系统配置信息,如系统名称、Logo、语言等
 */

interface SystemConfigContextType {
  config: SystemConfig | null
  isLoading: boolean
  error: Error | null
  refreshConfig: (options?: { refreshAuth?: boolean }) => Promise<void>
  markLoggedOut: () => void
  updateAuthUser: (user: User) => void
  authStatus: AuthStatusResponse | null
}

const SystemConfigContext = createContext<SystemConfigContextType | undefined>(undefined)

interface SystemConfigProviderProps {
  children: ReactNode
}

// 默认系统配置（用于未能从后端获取配置时的兜底）
export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  system_name: DEFAULT_BRAND_NAME,
  system_logo: DEFAULT_BRAND_LOGO,
  system_favicon: DEFAULT_BRAND_ICON,
  default_language: "zh-CN",
  default_timezone: "Asia/Shanghai",
  date_format: "YYYY-MM-DD HH:mm:ss",
  download_exclude_patterns: "node_modules,.git,.cache",
  default_download_mode: "fast",
  skip_excluded_on_upload: true,
  max_file_upload_size: 100,
  transfer_storage_path: "",
  transfer_retention_days: 3,
  transfer_max_storage_gb: 10,
  transfer_max_concurrency: 2,
  transfer_cleanup_enabled: true,
  job_queue_max_concurrency: 2,
  tab_session: {
    max_tabs: 50,
    inactive_minutes: 60,
    hibernate: true,
    session_timeout: 30,
    remember_login: true,
  },
  oauth_access_token_minutes: 15,
  oauth_refresh_token_days: 30,
  external_oauth_provider_enabled: false,
}

/** 认证状态与路由加载器共享缓存，刷新配置时保留已显示的内容。 */
export function SystemConfigProvider({ children }: SystemConfigProviderProps) {
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const query = useQuery(authStatusQueryOptions(shouldRestoreAuthSession(pathname)))
  const authStatus = query.data ?? null
  const config = authStatus?.system_config ?? (query.isError ? DEFAULT_SYSTEM_CONFIG : null)

  const refreshConfig = async (options: { refreshAuth?: boolean } = {}) => {
    await queryClient.fetchQuery({ ...authStatusQueryOptions(options.refreshAuth ?? false), staleTime: 0 })
  }

  const markLoggedOut = useCallback(() => {
    // 丢弃前一个账号的业务数据，也取消尚未完成的预取。
    void queryClient.cancelQueries()
    queryClient.removeQueries({ predicate: (entry) => entry.queryKey[0] !== authStatusQueryKey[0] })
    queryClient.setQueryData<AuthStatusResponse>(authStatusQueryKey, (current) => ({
      need_init: current?.need_init ?? false,
      is_authenticated: false,
      system_config: current?.system_config ?? DEFAULT_SYSTEM_CONFIG,
      access_token_ttl_seconds: 0,
    }))
  }, [queryClient])

  const updateAuthUser = useCallback((user: User) => {
    queryClient.setQueryData<AuthStatusResponse>(authStatusQueryKey, (current) => (
      current?.is_authenticated ? { ...current, user } : current
    ))
  }, [queryClient])

  return (
    <SystemConfigContext.Provider value={{ config, isLoading: query.isPending, error: query.error, refreshConfig, markLoggedOut, updateAuthUser, authStatus }}>
      {children}
    </SystemConfigContext.Provider>
  )
}

interface StaticSystemConfigProviderProps {
  children: ReactNode
  config?: SystemConfig
  authStatus?: AuthStatusResponse | null
}

export function StaticSystemConfigProvider({
  children,
  config = DEFAULT_SYSTEM_CONFIG,
  authStatus,
}: StaticSystemConfigProviderProps) {
  const resolvedAuthStatus: AuthStatusResponse = authStatus ?? {
    need_init: false,
    is_authenticated: true,
    system_config: config,
    access_token_ttl_seconds: 0,
  }

  return (
    <SystemConfigContext.Provider
      value={{
        config,
        isLoading: false,
        error: null,
        refreshConfig: async () => undefined,
        markLoggedOut: () => undefined,
        updateAuthUser: () => undefined,
        authStatus: resolvedAuthStatus,
      }}
    >
      {children}
    </SystemConfigContext.Provider>
  )
}

/**
 * 使用系统配置的 Hook
 * @returns 系统配置上下文
 * @throws 如果在 SystemConfigProvider 外部使用
 */
export function useSystemConfig() {
  const context = useContext(SystemConfigContext)
  if (context === undefined) {
    throw new Error("useSystemConfig must be used within a SystemConfigProvider")
  }
  return context
}

export function useOptionalSystemConfig() {
  return useContext(SystemConfigContext) ?? null
}
