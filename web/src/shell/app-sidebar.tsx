import * as React from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { AISidebarTarget, useAISidebarHost } from "@easyssh/app/components/ai-agent/ai-sidebar-host"

import { NavMain } from "./nav-main"
import { NavUser } from "./nav-user"
import { QuickAccess } from "./quick-access"
import { SidebarBrand } from "./sidebar-brand"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@easyssh/app/components/ui/sidebar"
import { useClientAuth } from "@easyssh/app/components/client-auth-provider"
import { useRuntime } from "@easyssh/app/shell/runtime/runtime-provider"
import { buildNavigationGroups } from "@easyssh/app/shell/navigation/navigation-registry"
import { motionDurations } from "@easyssh/app/lib/motion"

export const AppSidebar = React.memo(function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { user } = useClientAuth()
  const { runtime } = useRuntime()
  const { t: tNav } = useTranslation("nav")
  const { pathname } = useLocation()
  const reduceMotion = useReducedMotion()
  const aiSidebar = useAISidebarHost()
  const isAIWorkspace =
    pathname === "/dashboard/ai-assistant" || pathname.startsWith("/dashboard/ai-assistant/")
  const showAI = isAIWorkspace && Boolean(aiSidebar?.ready)
  const { setOpen, isMobile } = useSidebar()
  const wasAIWorkspace = React.useRef(false)
  React.useEffect(() => {
    if (isAIWorkspace && !wasAIWorkspace.current && !isMobile) setOpen(true)
    wasAIWorkspace.current = isAIWorkspace
  }, [isAIWorkspace, isMobile, setOpen])
  const navigationGroups = React.useMemo(
    () =>
      buildNavigationGroups({
        runtime,
        t: tNav,
      }),
    [runtime, tNav],
  )

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent className="relative overflow-hidden gap-0 [scrollbar-gutter:auto]">
        <motion.div
          initial={false}
          animate={{ x: showAI ? "-100%" : "0%" }}
          transition={{
            type: "tween",
            duration: reduceMotion ? 0 : motionDurations.layout,
            ease: [0.4, 0, 0.2, 1],
          }}
          onAnimationComplete={() => aiSidebar?.clearInactiveContent()}
          className="relative min-h-0 w-full flex-1"
        >
          {/* inert 同时禁用焦点和辅助技术访问，避免 aria-hidden 隐藏仍持有焦点的导航。 */}
          <div
            inert={showAI}
            className="absolute inset-0 flex flex-col gap-2 overflow-y-auto overflow-x-hidden scrollbar-custom group-data-[collapsible=icon]:overflow-hidden"
          >
            <QuickAccess />
            {navigationGroups.workbench.length > 0 && (
              <NavMain label={tNav("workbench")} items={navigationGroups.workbench} />
            )}
            {navigationGroups.automation.length > 0 && (
              <NavMain label={tNav("automation")} items={navigationGroups.automation} />
            )}
            {navigationGroups.systemOrg.length > 0 && (
              <NavMain label={tNav("systemOrg")} items={navigationGroups.systemOrg} />
            )}
          </div>
          <div
            inert={!showAI}
            className="absolute inset-y-0 left-full flex w-full min-h-0 flex-col gap-2 overflow-hidden"
          >
            <AISidebarTarget
              navigation={
                <SidebarMenu className="shrink-0">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip={tNav("backToMainMenu")}
                      className="text-xs font-medium text-sidebar-foreground/70"
                    >
                      <Link
                        to={
                          navigationGroups.workbench.find(
                            (item) => item.url !== "/dashboard/ai-assistant",
                          )?.url ?? "/dashboard"
                        }
                      >
                        <ArrowLeft />
                        <span>{tNav("backToMainMenu")}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              }
            />
          </div>
        </motion.div>
      </SidebarContent>
      <SidebarFooter>
        {/* 用户信息区域：加载时显示占位，加载完成后显示真实内容 */}
        {user ? (
          <NavUser />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="pointer-events-none">
                <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
                <div className="grid flex-1 text-left text-sm leading-tight gap-0.5">
                  <div className="h-3.5 w-20 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                </div>
                <div className="ml-auto h-4 w-4 bg-muted rounded animate-pulse" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
})
