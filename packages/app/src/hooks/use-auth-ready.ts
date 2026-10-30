
import { useOptionalSystemConfig } from "@/contexts/system-config-context"

/**
 * 统一的认证就绪 Hook
 *
 * 适用于挂在 SystemConfigProvider 之下的受保护页面：
 * - ready 为 true 时，说明：
 *   - 全局 /auth/status 已加载完毕（不在 isLoading 状态）
 *   - 当前会话已通过认证且包含用户信息
 *   - 可以安全发起业务请求
 */
export function useAuthReady() {
  const systemConfig = useOptionalSystemConfig()
  const authStatus = systemConfig?.authStatus ?? null
  const isLoading = systemConfig?.isLoading ?? false
  const isAuthenticated = !!authStatus?.is_authenticated && !!authStatus.user

  const ready =
    !isLoading &&
    !!authStatus &&
    isAuthenticated

  return {
    ready,
    isAuthenticated,
    authStatus,
    isInitializing: isLoading,
  }
}
