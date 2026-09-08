import { useCallback, useEffect, type ReactNode } from "react"
import { ArrowLeft } from "@easyssh/ssh-workspace/desktop"
import { useTranslation } from "react-i18next"
import { AIAssistantWorkspaceView } from "@/components/ai-agent/ai-assistant-workspace-view"
import { AISidebarHost, AISidebarTarget } from "@/components/ai-agent/ai-sidebar-host"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import type { Locale } from "@/i18n"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

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
  const { t: tAI } = useTranslation("aiAssistant")
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar()
  const sidebarExpanded = isMobile ? openMobile : open
  const toggleLabel = tAI(sidebarExpanded ? "collapseSidebar" : "expandSidebar")

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
          <Button
            variant="ghost"
            size="sm"
            className="h-8 [--wails-draggable:no-drag]"
            onClick={returnToTerminal}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("returnToTerminalLabel")}
          </Button>
          <SidebarTrigger
            className="[--wails-draggable:no-drag]"
            aria-label={toggleLabel}
            aria-expanded={sidebarExpanded}
            title={toggleLabel}
          />
          <div className="min-w-0 truncate text-sm font-medium">{t("aiAssistantLabel")}</div>
          <div className="min-w-0 flex-1" />
          {headerActions}
        </header>
        <DesktopPageContent scrollable={false}>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            {active && (
              <Sidebar collapsible="icon" className="absolute h-full">
                <SidebarContent className="overflow-hidden">
                  <AISidebarTarget />
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
