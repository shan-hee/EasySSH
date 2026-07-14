
import { createContext, useContext, useCallback, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { authApi, type User } from "@/lib/api/auth"
import { useSystemConfig } from "@/contexts/system-config-context"
import { useAuthStore } from "@/stores/auth-store"
import { useTerminalStore } from "@/stores/terminal-store"
import { isApiError } from "@/lib/api-client"
import {
  buildLockedLoginRedirectUrl,
  buildLoginRedirectUrl,
  getAuthLockInfo,
  getCurrentBrowserPath,
} from "@/lib/auth-redirect"

interface ClientAuthContextType {
  user: User | null
  isAuthenticated: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const ClientAuthContext = createContext<ClientAuthContextType | undefined>(undefined)

// Bearer-only 主链路：access_token 仅存内存，refresh_token 仅存 HttpOnly Cookie

/**
 * 客户端认证 Provider
 * 注意: access_token 仅保存在内存中，refresh_token 由后端通过 HttpOnly Cookie 管理
 */
export function ClientAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { authStatus, markLoggedOut, updateAuthUser } = useSystemConfig()
  const clearToken = useAuthStore((state) => state.clearToken)
  const resetTerminals = useTerminalStore((state) => state.resetAll)
  const user: User | null = authStatus?.is_authenticated
    ? authStatus.user ?? null
    : null
  const isAuthenticated = user !== null

  // 刷新用户信息
  const refreshUser = useCallback(async () => {
    try {
      const userData = await authApi.getCurrentUser()
      updateAuthUser(userData)
    } catch (error) {
      if (isApiError(error) && error.status === 403) {
        const detail = error.detail as { error?: string } | undefined
        if (detail?.error === 'account_locked') {
          clearToken()
          resetTerminals()
          markLoggedOut()
          navigate(
            buildLockedLoginRedirectUrl(getAuthLockInfo(error.detail), getCurrentBrowserPath()),
            { replace: true },
          )
          return
        }
      }

      if (isApiError(error) && (error.status === 401 || error.status === 404)) {
        clearToken()
        resetTerminals()
        markLoggedOut()
        navigate(buildLoginRedirectUrl(getCurrentBrowserPath()), { replace: true })
        return
      }

      throw error
    }
  }, [clearToken, markLoggedOut, navigate, resetTerminals, updateAuthUser])

  // 登出
  // 后端会自动清除 HttpOnly Cookie，同时前端清空内存中的 access_token
  const logout = useCallback(async () => {
    await authApi.logout()
    clearToken()
    resetTerminals()
    markLoggedOut()
    navigate("/login", { replace: true })
  }, [clearToken, markLoggedOut, navigate, resetTerminals])

  return (
    <ClientAuthContext.Provider
      value={{
        user,
        isAuthenticated,
        logout,
        refreshUser,
      }}
    >
      {children}
    </ClientAuthContext.Provider>
  )
}

/**
 * 使用客户端认证上下文
 */
export function useClientAuth() {
  const context = useContext(ClientAuthContext)
  if (context === undefined) {
    throw new Error("useClientAuth must be used within a ClientAuthProvider")
  }
  return context
}

export function useOptionalClientAuth() {
  return useContext(ClientAuthContext) ?? null
}
