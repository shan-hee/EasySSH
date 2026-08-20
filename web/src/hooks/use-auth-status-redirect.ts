
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useSystemConfig } from "@/contexts/system-config-context"
import {
  getAuthRedirectDecision,
  getCurrentBrowserPath,
  isLoginPath,
  type AuthGatePage,
} from "@/lib/auth-redirect"

type EntryPage = Extract<AuthGatePage, "home" | "login">

interface UseAuthStatusRedirectResult {
  isChecking: boolean
}

/**
 * 统一处理入口页的认证/初始化状态检查与跳转逻辑
 *
 * - home: 根据状态跳转到 /setup /dashboard /login
 * - login: 已初始化且未登录时才停留在当前页,其他情况跳转
 *
 * 对 login 页有一个额外优化:
 * - 挂载时若全局认证检查已经完成，直接沿用结果，不额外闪现启动占位
 * - 后续 refreshConfig 触发的 isLoading 不再重置为初始检查状态
 */
export function useAuthStatusRedirect(page: EntryPage): UseAuthStatusRedirectResult {
  const navigate = useNavigate()
  const { authStatus, error, isLoading } = useSystemConfig()
  const [hasCompletedInitialCheck, setHasCompletedInitialCheck] = useState(
    () => !isLoading && (authStatus !== null || error !== null),
  )

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (error && !authStatus) {
      setHasCompletedInitialCheck(true)
      return
    }

    const currentPath = getCurrentBrowserPath()
    const decision = getAuthRedirectDecision(page, authStatus, { currentPath })
    if (decision.type === "redirect") {
      navigate(decision.href, { replace: true })
      if (page === "login" && isLoginPath(decision.href)) {
        setHasCompletedInitialCheck(true)
      }
      return
    }

    setHasCompletedInitialCheck(true)
  }, [authStatus, error, isLoading, navigate, page])

  return {
    isChecking: page === "login" ? !hasCompletedInitialCheck : true,
  }
}
