
import { createContext, useContext, type ReactNode } from "react"
import type { SystemConfig } from "@/lib/api/settings"
import { type AuthStatusResponse, type User } from "@/lib/api/auth"
import {
  DEFAULT_BRAND_ICON,
  DEFAULT_BRAND_LOGO,
  DEFAULT_BRAND_NAME,
} from "@/lib/brand"

/**
 * 系统配置 Context
 * 提供全局系统配置信息,如系统名称、Logo、语言等
 */

export interface SystemConfigContextType {
  workspaceReady?: boolean
  config: SystemConfig | null
  isLoading: boolean
  error: Error | null
  refreshConfig: () => Promise<void>
  markLoggedOut: () => void
  updateAuthUser: (user: User) => void
  authStatus: AuthStatusResponse | null
}

const SystemConfigContext = createContext<SystemConfigContextType | undefined>(undefined)

/** 宿主以自身的认证状态来源提供系统配置；Web 由所有者会话查询提供，桌面使用静态配置。 */
export const SystemConfigContextProvider = SystemConfigContext.Provider

// 默认系统配置（用于未能从后端获取配置时的兜底）
export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  public_url: "",
  system_name: DEFAULT_BRAND_NAME,
  system_logo: DEFAULT_BRAND_LOGO,
  system_favicon: DEFAULT_BRAND_ICON,
  default_language: "zh-CN",
  default_timezone: "Asia/Shanghai",
  date_format: "YYYY-MM-DD HH:mm:ss",
  download_exclude_patterns: "node_modules,.git,.cache",
  skip_excluded_on_upload: true,
  max_file_upload_size: 100,
  transfer_storage_path: "",
  transfer_retention_days: 3,
  transfer_max_storage_gb: 10,
  transfer_max_concurrency: 2,
  transfer_max_entries: 100000,
  transfer_max_depth: 128,
  transfer_cleanup_enabled: true,
  sftp_max_idle_time_seconds: 120,
  sftp_cleanup_interval_seconds: 30,
  sftp_max_life_time_minutes: 0,
  sftp_conn_timeout_seconds: 10,
  sftp_max_sessions_per_conn: 8,
  job_queue_max_concurrency: 2,
  tab_session: {
    max_tabs: 50,
    inactive_minutes: 60,
    hibernate: true,
    session_timeout: 30,
    remember_login: true,
  },
}

interface StaticSystemConfigProviderProps {
  workspaceReady?: boolean
  children: ReactNode
  config?: SystemConfig
  authStatus?: AuthStatusResponse | null
}

export function StaticSystemConfigProvider({
  children,
  config = DEFAULT_SYSTEM_CONFIG,
  authStatus,
  workspaceReady,
}: StaticSystemConfigProviderProps) {
  const resolvedAuthStatus: AuthStatusResponse = authStatus ?? {
    need_init: false,
    is_authenticated: true,
    system_config: config,
  }

  return (
    <SystemConfigContext.Provider
      value={{
        config,
        workspaceReady,
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
