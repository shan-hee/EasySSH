import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { User } from "@/lib/api/auth"

export type AccountPreferences = Partial<Pick<User, "language" | "timezone">>

export interface ClientAuthContextType {
  user: User | null
  isAuthenticated: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  /** 保存账户偏好（例如界面语言）；宿主没有账户偏好存储时不提供。 */
  updatePreferences?: (preferences: AccountPreferences) => Promise<void>
}

const ClientAuthContext = createContext<ClientAuthContextType | undefined>(undefined)

/** 宿主提供当前访问主体；Web 由所有者会话实现，桌面使用本机所有者的静态实现。 */
export const ClientAuthContextProvider = ClientAuthContext.Provider

/** 本机所有者等无需登录流程的宿主使用：不提供登出与账户偏好存储。 */
export function StaticClientAuthProvider({ user, children }: { user: User | null; children: ReactNode }) {
  const value = useMemo<ClientAuthContextType>(() => ({
    user,
    isAuthenticated: user !== null,
    logout: async () => undefined,
    refreshUser: async () => undefined,
  }), [user])

  return <ClientAuthContext.Provider value={value}>{children}</ClientAuthContext.Provider>
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
