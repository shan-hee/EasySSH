
import { useOptionalSystemConfig } from "@/contexts/system-config-context"

/**
 * 统一的认证就绪 Hook
 *
 * 适用于挂在 SystemConfigProvider 之下的受保护页面：
 * - ready 为 true 时，说明：
 *   - 所有者认证上下文已加载，或宿主已验证分享工作区上下文
 *   - 所有者包含用户信息；分享访客使用独立的 workspaceReady
 *   - 可以安全发起业务请求
 */
export function useAuthReady() {
  const systemConfig = useOptionalSystemConfig()
  const authStatus = systemConfig?.authStatus ?? null
  const isLoading = systemConfig?.isLoading ?? false
  const isAuthenticated = systemConfig?.workspaceReady ?? (!!authStatus?.is_authenticated && !!authStatus.user)

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
