import { useEffect } from "react"
import { AIAssistantWorkspaceView } from "@/components/ai-agent/ai-assistant-workspace-view"
import { AISidebarHost, AISidebarTarget } from "@/components/ai-agent/ai-sidebar-host"
import {
  Sidebar,
  SidebarContent,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import type { Locale } from "@/i18n"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopAIAssistantView({
  adapters,
  locale,
  active,
}: {
  adapters: DesktopAIAssistantAdapters
  locale: Locale
  active: boolean
}) {
  const { setOpenMobile } = useSidebar()

  useEffect(() => {
    if (!active) setOpenMobile(false)
  }, [active, setOpenMobile])

  return (
    <DesktopWebViewShell locale={locale}>
      <AISidebarHost>
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
