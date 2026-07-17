
import { useEffect, useRef } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import SidebarProviderServer from "@/components/sidebar-provider-server"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/contexts/system-config-context"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import { getAuthRedirectDecision, getCurrentBrowserPath } from "@/lib/auth-redirect"
import { useRuntime } from "@/shell/runtime/runtime-provider"
import { getRouteFallback, isRouteAllowed } from "@/shell/navigation/route-policy"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

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
  const { t } = useTranslation("common")
  const { pathname } = useLocation()
  const { authStatus, error, isLoading, refreshConfig } = useSystemConfig()
  const { runtime, isLoading: isRuntimeLoading } = useRuntime()
  const user = authStatus?.is_authenticated ? authStatus.user : null

  useEffect(() => {
    if (isLoading || (error && !authStatus?.is_authenticated)) return

    const currentPath = getCurrentBrowserPath()
    const decision = getAuthRedirectDecision("dashboard", authStatus, { currentPath })
    if (decision.type === "redirect") {
      navigate(decision.href, { replace: true })
    }
  }, [authStatus, error, isLoading, navigate, pathname])

  useEffect(() => {
    if (isLoading || (error && !authStatus?.is_authenticated) || isRuntimeLoading || !runtime) return
		const permissions = user?.permissions || []
		const isOwner = runtime.principal.role === "owner"
		if (isRouteAllowed(runtime, pathname, permissions, isOwner)) return

		navigate(getRouteFallback(pathname, runtime, permissions, isOwner), { replace: true })
	}, [authStatus?.is_authenticated, error, isLoading, isRuntimeLoading, navigate, pathname, runtime, user?.permissions])

  if (isLoading && !authStatus) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-10 text-muted-foreground" aria-label={t("loading")} />
      </div>
    )
  }

  if (error && !authStatus?.is_authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <p className="text-muted-foreground">{t("authStatusUnavailable")}</p>
          <Button onClick={() => void refreshConfig({ refreshAuth: true })}>
            {t("retry")}
          </Button>
        </div>
      </div>
    )
  }

  if (!authStatus?.is_authenticated || !authStatus.user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-10 text-muted-foreground" aria-label={t("loading")} />
      </div>
    )
  }

  return (
    <ClientAuthProvider>
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
