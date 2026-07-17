
import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import type { SystemConfig } from "@/lib/api/settings"
import { authApi, type AuthStatusResponse, type User } from "@/lib/api/auth"
import { useAuthStore } from "@/stores/auth-store"

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
  system_name: "EasySSH",
  system_logo: "/logo.svg",
  system_favicon: "/favicon.ico",
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
  tab_session: {
    max_tabs: 50,
    inactive_minutes: 60,
    hibernate: true,
    session_timeout: 30,
    remember_login: true,
  },
  oauth_access_token_minutes: 15,
  oauth_refresh_token_days: 30,
}

export function shouldRestoreAuthSession(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/")
  )
}

/**
 * 系统配置提供者组件
 * 在应用启动时自动加载系统配置并提供给所有子组件
 */
export function SystemConfigProvider({ children }: SystemConfigProviderProps) {
  const { pathname } = useLocation()
  const [config, setConfig] = useState<SystemConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null)
  const clearToken = useAuthStore((state) => state.clearToken)

  const loadConfig = async (options: { refreshAuth?: boolean } = {}) => {
    try {
      setIsLoading(true)
      setError(null)

      // 仅通过 /auth/status 获取系统配置和认证状态（开发版约定始终返回 system_config）
      const status = await authApi.checkStatus({ refresh: options.refreshAuth ?? false })
      setAuthStatus(status)
      if (!status.is_authenticated) {
        clearToken()
      }

      if (!status.system_config) {
        // 按当前开发版约定，system_config 应始终存在
        throw new Error("system_config is missing in /auth/status response")
      }

      setConfig(status.system_config)
    } catch (err) {
      console.error("Failed to load system config:", err)
      setError(err instanceof Error ? err : new Error("Unknown error"))

      // 请求失败时，使用本地默认配置兜底
      setConfig(DEFAULT_SYSTEM_CONFIG)
    } finally {
      setIsLoading(false)
    }
  }

  const refreshConfig = async (options: { refreshAuth?: boolean } = {}) => {
    await loadConfig(options)
  }

  const markLoggedOut = useCallback(() => {
    const systemConfig = config ?? authStatus?.system_config ?? DEFAULT_SYSTEM_CONFIG
    setConfig(systemConfig)
    setAuthStatus({
      need_init: authStatus?.need_init ?? false,
      is_authenticated: false,
      system_config: systemConfig,
      access_token_ttl_seconds: authStatus?.access_token_ttl_seconds ?? 0,
    })
    setError(null)
    setIsLoading(false)
  }, [
    authStatus?.access_token_ttl_seconds,
    authStatus?.need_init,
    authStatus?.system_config,
    config,
  ])

  const updateAuthUser = useCallback((user: User) => {
    setAuthStatus((current) => {
      if (!current?.is_authenticated) {
        return current
      }
      return {
        ...current,
        user,
      }
    })
  }, [])

  useEffect(() => {
    loadConfig({ refreshAuth: shouldRestoreAuthSession(pathname) })
    // 初始加载时按入口路径决定是否尝试 refresh cookie 恢复会话。
    // 后续路由跳转由登录/登出流程显式调用 refreshConfig 控制。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SystemConfigContext.Provider value={{ config, isLoading, error, refreshConfig, markLoggedOut, updateAuthUser, authStatus }}>
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
