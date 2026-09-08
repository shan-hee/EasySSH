import { useCallback, useEffect, type ReactNode } from "react"
import { ArrowLeft } from "@easyssh/ssh-workspace/desktop"
import { useTranslation } from "react-i18next"
import { AIAssistantWorkspaceView } from "@/components/ai-agent/ai-assistant-workspace-view"
import { AISidebarHost, AISidebarTarget } from "@/components/ai-agent/ai-sidebar-host"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { DEFAULT_BRAND_NAME } from "@/lib/brand"
import type { Locale } from "@/i18n"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

const teams = [{ name: DEFAULT_BRAND_NAME }]

export function DesktopAIAssistantView({
  adapters,
  locale,
  active,
  onReturnToTerminal,
  headerActions,
}: {
  adapters: DesktopAIAssistantAdapters
  locale: Locale
  active: boolean
  onReturnToTerminal: () => void
  headerActions?: ReactNode
}) {
  const { t } = useTranslation("desktop")
  const { t: tNav } = useTranslation("nav")
  const { setOpenMobile } = useSidebar()

  useEffect(() => {
    if (!active) setOpenMobile(false)
  }, [active, setOpenMobile])

  const returnToTerminal = useCallback(() => {
    setOpenMobile(false)
    onReturnToTerminal()
  }, [onReturnToTerminal, setOpenMobile])

  return (
    <DesktopWebViewShell locale={locale}>
      <AISidebarHost>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background/65 pl-3 [--wails-draggable:drag]">
          <SidebarTrigger
            className="md:hidden [--wails-draggable:no-drag]"
            aria-label={tNav("openSidebar")}
          />
          <div className="min-w-0 truncate text-sm font-medium">{t("aiAssistantLabel")}</div>
          <div className="min-w-0 flex-1" />
          {headerActions}
        </header>
        <DesktopPageContent scrollable={false}>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            {active && (
              <Sidebar collapsible="icon" className="absolute h-full">
                <SidebarHeader>
                  <TeamSwitcher teams={teams} onHome={returnToTerminal} />
                </SidebarHeader>
                <SidebarContent className="overflow-hidden">
                  <AISidebarTarget
                    navigation={
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            tooltip={t("returnToTerminalLabel")}
                            className="text-xs font-medium text-sidebar-foreground/70"
                            onClick={returnToTerminal}
                          >
                            <ArrowLeft />
                            <span>{t("returnToTerminalLabel")}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    }
                  />
                </SidebarContent>
                <SidebarRail />
              </Sidebar>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AIAssistantWorkspaceView
                active={active}
                hidePageHeader
                customConfigOnly
                adapters={adapters}
              />
            </div>
          </div>
        </DesktopPageContent>
      </AISidebarHost>
    </DesktopWebViewShell>
  )
}
