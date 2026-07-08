
import { useEffect, useRef } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import SidebarProviderServer from "@/components/sidebar-provider-server"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/contexts/system-config-context"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import { getAuthRedirectDecision, getCurrentBrowserPath } from "@/lib/auth-redirect"
import type { User } from "@/lib/api/auth"
import { useRuntime } from "@/shell/runtime/runtime-provider"
import { getRouteFallback, isRouteAllowed } from "@/shell/navigation/route-policy"

function MobileSidebarRouteCloser() {
  const { pathname } = useLocation()
  const { isMobile, openMobile, setOpenMobile } = useSidebar()
  const previousPathRef = useRef(pathname)

  useEffect(() => {
    if (previousPathRef.current === pathname) {
      return
    }

    previousPathRef.current = pathname

    if (isMobile && openMobile) {
      setOpenMobile(false)
    }
  }, [isMobile, openMobile, pathname, setOpenMobile])

  return null
}

/**
 * Dashboard 布局 - Client Component
 * 乐观渲染模式：先渲染界面，后台静默验证认证状态
 */
export default function DashboardLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { authStatus, isLoading } = useSystemConfig()
  const { runtime, isLoading: isRuntimeLoading } = useRuntime()
  const initialUser: User | null =
    authStatus && authStatus.is_authenticated && authStatus.user
      ? authStatus.user
      : null

  useEffect(() => {
    if (isLoading) return

    const currentPath = getCurrentBrowserPath(pathname)
    const decision = getAuthRedirectDecision("dashboard", authStatus, { currentPath })
    if (decision.type === "redirect") {
      navigate(decision.href, { replace: true })
    }
  }, [authStatus, isLoading, navigate, pathname])

  useEffect(() => {
    if (isLoading || isRuntimeLoading || !runtime) return
    const isAdmin = initialUser?.role === "admin" || runtime.principal.role === "owner"
    if (isRouteAllowed(runtime, pathname, isAdmin)) return

    navigate(getRouteFallback(pathname, runtime, isAdmin), { replace: true })
  }, [initialUser?.role, isLoading, isRuntimeLoading, navigate, pathname, runtime])

  // 乐观渲染：立即显示界面，后台验证
  // 如果验证失败，会自动跳转到登录页
  return (
    <ClientAuthProvider initialUser={initialUser}>
      <DashboardI18nProvider>
        <SidebarProviderServer>
          <MobileSidebarRouteCloser />
          <AppSidebar />
          <SidebarInset>
            {/* 添加淡入动画，使界面显示更平滑 */}
            <div className="animate-in fade-in duration-300 flex min-h-0 flex-1 flex-col overflow-hidden scrollbar-custom">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProviderServer>
      </DashboardI18nProvider>
    </ClientAuthProvider>
  )
}
