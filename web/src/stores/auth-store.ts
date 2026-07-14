import { create } from "zustand"

interface AuthState {
  accessToken: string | null
  expiresAt: number | null // Unix 毫秒时间戳

  setToken: (token: string, expiresInSeconds: number) => void
  clearToken: () => void
}

/**
 * 全局认证状态（仅管理 access_token，refresh_token 始终保存在 HttpOnly Cookie 中）
 */
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  expiresAt: null,

  setToken: (token: string, expiresInSeconds: number) => {
    set({
      accessToken: token,
      expiresAt: expiresInSeconds > 0
        ? Date.now() + expiresInSeconds * 1000
        : null,
    })
  },

  clearToken: () => {
    set({
      accessToken: null,
      expiresAt: null,
    })
  },
}))
