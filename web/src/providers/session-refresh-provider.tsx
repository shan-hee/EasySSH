import type React from "react"
import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useSystemConfig } from "@/contexts/system-config-context"
import { buildLoginRedirectUrl, getCurrentBrowserPath } from "@/lib/auth-redirect"
import {
  isRefreshTokenError,
  refreshAccessToken,
} from "@/lib/session-refresh"
import { useAuthStore } from "@/stores/auth-store"
import { useTerminalStore } from "@/stores/terminal-store"

interface SessionRefreshProviderProps {
  children: React.ReactNode
}

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]
const REFRESH_ON_RESUME_THRESHOLD_MS = 60_000

/**
 * 根据 AuthStore 中的绝对过期时间安排 Access Token 刷新。
 * 所有刷新调用最终都会进入 session-refresh 的全局 single-flight。
 */
export function SessionRefreshProvider({ children }: SessionRefreshProviderProps) {
  const navigate = useNavigate()
  const { authStatus, markLoggedOut } = useSystemConfig()
  const accessToken = useAuthStore((state) => state.accessToken)
  const expiresAt = useAuthStore((state) => state.expiresAt)
  const clearToken = useAuthStore((state) => state.clearToken)
  const resetTerminals = useTerminalStore((state) => state.resetAll)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let retryAttempt = 0

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    clearTimer()

    if (
      !authStatus?.is_authenticated ||
      !accessToken ||
      expiresAt === null
    ) {
      return
    }

    const expireSession = () => {
      clearTimer()
      clearToken()
      resetTerminals()
      markLoggedOut()
      navigate(buildLoginRedirectUrl(getCurrentBrowserPath()), { replace: true })
    }

    const scheduleRetry = (refresh: () => Promise<void>) => {
      if (cancelled) return
      const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)]
      retryAttempt += 1
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        void refresh()
      }, delay)
    }

    const runRefresh = async () => {
      clearTimer()
      try {
        await refreshAccessToken()
        retryAttempt = 0
        // refreshAccessToken 会更新 expiresAt，由 effect 重建下一次定时器。
      } catch (error) {
        if (cancelled) return
        if (isRefreshTokenError(error) && error.status === 401) {
          expireSession()
          return
        }
        scheduleRetry(runRefresh)
      }
    }

    const scheduleFromExpiry = () => {
      if (cancelled) return
      clearTimer()
      const remainingMs = expiresAt - Date.now()
      const delayMs = remainingMs <= 0
        ? 0
        : Math.max(1_000, Math.floor(remainingMs * 0.8))
      timerRef.current = window.setTimeout(() => {
        void runRefresh()
      }, delayMs)
    }

    const refreshIfNeeded = () => {
      if (cancelled) return
      if (expiresAt - Date.now() <= REFRESH_ON_RESUME_THRESHOLD_MS) {
        void runRefresh()
        return
      }
      scheduleFromExpiry()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfNeeded()
      }
    }

    scheduleFromExpiry()
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("online", refreshIfNeeded)

    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("online", refreshIfNeeded)
    }
  }, [
    accessToken,
    authStatus?.is_authenticated,
    clearToken,
    expiresAt,
    markLoggedOut,
    navigate,
    resetTerminals,
  ])

  return <>{children}</>
}
