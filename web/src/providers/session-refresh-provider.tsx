import type React from "react"
import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useSystemConfig } from "@/contexts/system-config-context"
import {
  buildLoginRedirectUrl,
  buildSessionTimeoutLoginRedirectUrl,
  getCurrentBrowserPath,
} from "@/lib/auth-redirect"
import {
  isTerminalRefreshTokenError,
  refreshAccessToken,
  suspendSessionRefresh,
} from "@/lib/session-refresh"
import { authApi } from "@/lib/api/auth"
import { useAuthStore } from "@/stores/auth-store"
import { useTerminalStore } from "@/stores/terminal-store"
import {
  authSessionStorageKeys,
  getLastAuthActivity,
  isAuthIdleExpired,
  markAuthIdleExpired,
  recordAuthActivity,
} from "@/lib/auth-session-activity"

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
  const { authStatus, config, markLoggedOut } = useSystemConfig()
  const accessToken = useAuthStore((state) => state.accessToken)
  const expiresAt = useAuthStore((state) => state.expiresAt)
  const clearToken = useAuthStore((state) => state.clearToken)
  const resetTerminals = useTerminalStore((state) => state.resetAll)
  const timerRef = useRef<number | null>(null)
  const idleTimerRef = useRef<number | null>(null)
  const idleExpirationStartedRef = useRef(false)

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
        if (isTerminalRefreshTokenError(error)) {
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

  useEffect(() => {
    if (!authStatus?.is_authenticated || !accessToken) {
      return
    }

    const timeoutMinutes = config?.tab_session?.session_timeout ?? 30
    const timeoutMs = timeoutMinutes * 60_000
    let disposed = false
    let lastRecordedAt = 0

    const clearIdleTimer = () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }

    const expireForInactivity = () => {
      if (disposed || idleExpirationStartedRef.current) return
      idleExpirationStartedRef.current = true
      clearIdleTimer()
      markAuthIdleExpired()

      // 先在本地切断认证状态；服务端撤销失败时，本地超时标记会阻止刷新 Cookie 自动恢复会话。
      clearToken()
      resetTerminals()
      markLoggedOut()
      navigate(
        buildSessionTimeoutLoginRedirectUrl(getCurrentBrowserPath()),
        { replace: true },
      )

      void (async () => {
        await suspendSessionRefresh()
        try {
          await authApi.logout()
        } catch {
          // 本地闲置退出标记会继续阻止 Cookie 恢复；后续进入登录页时会再次尝试服务端登出。
        } finally {
          clearToken()
        }
      })()
    }

    const scheduleIdleExpiration = () => {
      if (disposed || isAuthIdleExpired()) {
        expireForInactivity()
        return
      }

      clearIdleTimer()
      const lastActivity = getLastAuthActivity() ?? Date.now()
      const remainingMs = lastActivity + timeoutMs - Date.now()
      if (remainingMs <= 0) {
        expireForInactivity()
        return
      }

      idleTimerRef.current = window.setTimeout(expireForInactivity, remainingMs)
    }

    const handleUserActivity = () => {
      if (disposed || isAuthIdleExpired()) return
      const now = Date.now()
      if (now - lastRecordedAt < 1_000) return
      lastRecordedAt = now
      recordAuthActivity(now)
      scheduleIdleExpiration()
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === authSessionStorageKeys.idleExpired && event.newValue) {
        expireForInactivity()
        return
      }
      if (event.key === authSessionStorageKeys.activity && event.newValue) {
        scheduleIdleExpiration()
      }
    }

    if (getLastAuthActivity() === null) {
      recordAuthActivity()
    }
    idleExpirationStartedRef.current = false
    scheduleIdleExpiration()

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "keydown",
      "touchstart",
      "scroll",
    ]
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, handleUserActivity, { passive: true })
    }
    window.addEventListener("storage", handleStorage)

    return () => {
      disposed = true
      clearIdleTimer()
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, handleUserActivity)
      }
      window.removeEventListener("storage", handleStorage)
    }
  }, [
    accessToken,
    authStatus?.is_authenticated,
    clearToken,
    config?.tab_session?.session_timeout,
    markLoggedOut,
    navigate,
    resetTerminals,
  ])

  return <>{children}</>
}
