
import { useEffect, useLayoutEffect, useRef } from "react"
import { motion } from "motion/react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import SidebarProviderServer from "@/components/sidebar-provider-server"
import { AppSidebar } from "@/components/app-sidebar"
import { PageHeaderHost } from "@/components/page-header"
import { SidebarInset, useSidebar } from "@/components/ui/sidebar"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/contexts/system-config-context"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import { getAuthRedirectDecision, getCurrentBrowserPath } from "@/lib/auth-redirect"
import { useRuntime } from "@/shell/runtime/runtime-provider"
import { getRouteFallback, isRouteAllowed } from "@/shell/navigation/route-policy"
import { Button } from "@/components/ui/button"
import { AppLoadingScreen } from "@/components/app-loading"
import { cn } from "@/lib/utils"
import { pageTransition } from "@/lib/motion"
import { preloadCommonDashboardRoutes } from "@/lib/dashboard-route-preload"
import { buildNavigationGroups } from "@/shell/navigation/navigation-registry"

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

function DashboardRouteOutlet({
  usesViewportWorkspace,
}: {
  usesViewportWorkspace: boolean
}) {
  const { pathname } = useLocation()

  if (usesViewportWorkspace) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    )
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={pageTransition}
      className="flex min-h-full w-full min-w-0 flex-1 flex-col"
    >
      <Outlet />
    </motion.div>
  )
}

/**
 * Dashboard 布局 - Client Component
 * 乐观渲染模式：先渲染界面，后台静默验证认证状态
 */
export default function DashboardLayout() {
  const navigate = useNavigate()
  const pageScrollRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation("common")
  const { t: tNav } = useTranslation("nav")
  const { pathname } = useLocation()
  const { authStatus, error, isLoading, refreshConfig } = useSystemConfig()
  const { runtime, isLoading: isRuntimeLoading } = useRuntime()
  const user = authStatus?.is_authenticated ? authStatus.user : null
  const usesViewportWorkspace = ["/dashboard/terminal", "/dashboard/ai-assistant"].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )
  const usesPageManagedScroll = usesViewportWorkspace || pathname === "/dashboard/settings"
  useLayoutEffect(() => {
    if (pageScrollRef.current) {
      pageScrollRef.current.scrollTop = 0
      pageScrollRef.current.scrollLeft = 0
    }
  }, [pathname])

  useEffect(() => {
    if (!authStatus?.is_authenticated || isRuntimeLoading || !runtime) {
      return
    }

    const permissions = user?.permissions || []
    const isOwner = runtime.principal.role === "owner"
    const navigationGroups = buildNavigationGroups({
      runtime,
      isOwner,
      permissions,
      t: tNav,
    })
    const availableRoutes = [
      ...navigationGroups.workbench,
      ...navigationGroups.systemOrg,
    ].map((item) => item.url)
    const preload = () => preloadCommonDashboardRoutes(availableRoutes)

    if (typeof window.requestIdleCallback === "function") {
      const idleCallback = window.requestIdleCallback(preload, { timeout: 1200 })
      return () => window.cancelIdleCallback(idleCallback)
    }

    const timeout = window.setTimeout(preload, 400)
    return () => window.clearTimeout(timeout)
  }, [authStatus?.is_authenticated, isRuntimeLoading, runtime, tNav, user?.permissions])

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
    return <AppLoadingScreen />
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
    return <AppLoadingScreen />
  }

  return (
    <ClientAuthProvider>
      <DashboardI18nProvider>
        <SidebarProviderServer className="h-svh overflow-hidden">
          <MobileSidebarRouteCloser />
          <AppSidebar />
          <SidebarInset className="h-svh overflow-hidden">
            <PageHeaderHost>
              <div
                ref={pageScrollRef}
                className={cn(
                  "flex min-h-0 min-w-0 flex-1 flex-col scrollbar-custom",
                  usesPageManagedScroll ? "overflow-hidden" : "overflow-y-scroll overscroll-y-contain",
                )}
              >
                <DashboardRouteOutlet usesViewportWorkspace={usesViewportWorkspace} />
              </div>
            </PageHeaderHost>
          </SidebarInset>
        </SidebarProviderServer>
      </DashboardI18nProvider>
    </ClientAuthProvider>
  )
}
