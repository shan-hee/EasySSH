import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react"
import { MotionConfig } from "motion/react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import SidebarProviderServer from "../components/sidebar-provider-server"
import { AppSidebar } from "../shell/app-sidebar"
import { AISidebarHost } from "@easyssh/app/components/ai-agent/ai-sidebar-host"
import { PageHeaderHost } from "@easyssh/app/components/page-header"
import { SidebarInset, useSidebar } from "@easyssh/app/components/ui/sidebar"
import { ClientAuthProvider } from "../platform/client-auth-provider"
import { useSystemConfig } from "@easyssh/app/contexts/system-config-context"
import { DashboardI18nProvider } from "@easyssh/app/providers/dashboard-i18n-provider"
import { getAuthRedirectDecision, getCurrentBrowserPath } from "../platform/auth-redirect"
import { RuntimeProvider, useRuntime } from "@easyssh/app/shell/runtime/runtime-provider"
import { getRouteFallback, isRouteAllowed } from "@easyssh/app/shell/navigation/route-policy"
import { Button } from "@easyssh/app/components/ui/button"
import { AppLoadingScreen } from "@easyssh/app/components/app-loading"
import { cn } from "@easyssh/app/lib/utils"

const AIAssistantPage = lazy(() => import("@easyssh/app/pages/dashboard/ai-assistant-page"))

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

function DashboardRouteOutlet({ usesViewportWorkspace }: { usesViewportWorkspace: boolean }) {
  const { pathname } = useLocation()
  const aiActive = pathname.replace(/\/$/, "") === "/dashboard/ai-assistant"
  const [aiVisited, setAIVisited] = useState(aiActive)
  useEffect(() => {
    if (aiActive) setAIVisited(true)
  }, [aiActive])

  return (
    <>
      {(aiVisited || aiActive) && (
        <div className={cn("min-h-0 min-w-0 flex-1 flex-col overflow-hidden", aiActive ? "flex" : "hidden")}>
          <Suspense fallback={null}>
            <AIAssistantPage active={aiActive} />
          </Suspense>
        </div>
      )}
      {!aiActive && (
        <div className={usesViewportWorkspace
          ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          : "flex min-h-full w-full min-w-0 flex-1 flex-col"}>
          <Outlet />
        </div>
      )}
    </>
  )
}

/**
 * Dashboard 布局 - Client Component
 * 路由 loader 完成首次鉴权；此处继续响应登录状态和权限的后续变化。
 */
function DashboardLayoutContent() {
  const navigate = useNavigate()
  useEffect(() => {
    const open = (event: Event) => { const id = (event as CustomEvent<{ id: string }>).detail?.id; if (id) navigate(`/dashboard/tasks?run=${encodeURIComponent(id)}`) }
    window.addEventListener("easyssh:open-task", open)
    return () => window.removeEventListener("easyssh:open-task", open)
  }, [navigate])
  const pageScrollRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation("common")
  const { pathname } = useLocation()
  const { authStatus, error, isLoading, refreshConfig } = useSystemConfig()
  const { runtime, isLoading: isRuntimeLoading } = useRuntime()
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
    if (isLoading || (error && !authStatus?.is_authenticated)) return

    const currentPath = getCurrentBrowserPath()
    const decision = getAuthRedirectDecision("dashboard", authStatus, { currentPath })
    if (decision.type === "redirect") {
      navigate(decision.href, { replace: true })
    }
  }, [authStatus, error, isLoading, navigate, pathname])

  useEffect(() => {
    if (isLoading || (error && !authStatus?.is_authenticated) || isRuntimeLoading || !runtime)
      return
    if (isRouteAllowed(runtime, pathname)) return

    navigate(getRouteFallback(pathname, runtime), { replace: true })
  }, [
    authStatus?.is_authenticated,
    error,
    isLoading,
    isRuntimeLoading,
    navigate,
    pathname,
    runtime,
  ])

  if (isLoading && !authStatus) {
    return <AppLoadingScreen />
  }

  if (error && !authStatus?.is_authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <p className="text-muted-foreground">{t("authStatusUnavailable")}</p>
          <Button onClick={() => void refreshConfig().catch(() => undefined)}>{t("retry")}</Button>
        </div>
      </div>
    )
  }

  if (!authStatus?.is_authenticated || !authStatus.user) {
    return <AppLoadingScreen />
  }

  return (
    <MotionConfig reducedMotion="user"><ClientAuthProvider>
      <DashboardI18nProvider>
        <SidebarProviderServer className="h-svh overflow-hidden">
          <AISidebarHost>
            <MobileSidebarRouteCloser />
            <AppSidebar />
            <SidebarInset className="h-svh overflow-hidden">
              <PageHeaderHost>
                <div
                  ref={pageScrollRef}
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1 flex-col scrollbar-custom",
                    usesPageManagedScroll
                      ? "overflow-hidden"
                      : "overflow-y-scroll overscroll-y-contain",
                  )}
                >
                  <DashboardRouteOutlet usesViewportWorkspace={usesViewportWorkspace} />
                </div>
              </PageHeaderHost>
            </SidebarInset>
          </AISidebarHost>
        </SidebarProviderServer>
      </DashboardI18nProvider>
    </ClientAuthProvider></MotionConfig>
  )
}

export default function DashboardLayout() {
  return <RuntimeProvider><DashboardLayoutContent /></RuntimeProvider>
}
