import { useCallback, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import type { User } from "@easyssh/app/lib/api/auth"
import { ClientAuthContextProvider, type AccountPreferences } from "@easyssh/app/components/client-auth-provider"
import { useSystemConfig } from "@easyssh/app/contexts/system-config-context"
import { useTerminalStore } from "@easyssh/app/stores/terminal-store"
import { ownerApi } from "../lib/api/owner"

/** 浏览器所有者会话的客户端认证 Provider；会话由 HttpOnly Cookie 承载。 */
export function ClientAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { authStatus, markLoggedOut, updateAuthUser } = useSystemConfig()
  const resetTerminals = useTerminalStore((state) => state.resetAll)
  const user: User | null = authStatus?.is_authenticated
    ? authStatus.user ?? null
    : null
  const isAuthenticated = user !== null

  // 会话失效由平台传输统一跳转登录页，这里只同步资料。
  const refreshUser = useCallback(async () => {
    updateAuthUser(await ownerApi.profile())
  }, [updateAuthUser])

  // 资料接口整体替换，偏好需与当前用户名和邮箱一起提交。
  const updatePreferences = useCallback(async (preferences: AccountPreferences) => {
    const current = await ownerApi.profile()
    await ownerApi.updateProfile({
      username: current.username,
      email: current.email,
      avatar: current.avatar,
      language: preferences.language ?? current.language,
      timezone: preferences.timezone ?? current.timezone,
    })
    await refreshUser()
  }, [refreshUser])

  const logout = useCallback(async () => {
    await ownerApi.logout()
    resetTerminals()
    markLoggedOut()
    navigate("/login", { replace: true })
  }, [markLoggedOut, navigate, resetTerminals])

  return (
    <ClientAuthContextProvider
      value={{
        user,
        isAuthenticated,
        logout,
        refreshUser,
        updatePreferences,
      }}
    >
      {children}
    </ClientAuthContextProvider>
  )
}
