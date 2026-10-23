import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "@easyssh/ssh-workspace/desktop"
import { Button } from "@/components/ui/button"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { desktopViews, type DesktopContentView } from "./desktop-view-registry"

/** The window controls stay mounted while the page code or translations load. */
export function DesktopPageHeader({ view, onReturnToTerminal, actions }: {
  view: DesktopContentView
  onReturnToTerminal: () => void
  actions: ReactNode
}) {
  const { t } = useTranslation("desktop", { useSuspense: false })
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar()
  const expanded = isMobile ? openMobile : open

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-transparent pl-3 [--wails-draggable:drag]">
      <Button variant="ghost" size="sm" className="h-8 [--wails-draggable:no-drag]" onClick={() => {
        setOpenMobile(false)
        onReturnToTerminal()
      }}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("returnToTerminalLabel")}
      </Button>
      {view === "ai" && <SidebarTrigger
        className="[--wails-draggable:no-drag]"
        aria-label={t(expanded ? "collapseSidebarLabel" : "expandSidebarLabel")}
        aria-expanded={expanded}
        title={t(expanded ? "collapseSidebarLabel" : "expandSidebarLabel")}
      />}
      <div className="min-w-0 truncate text-sm font-medium">{t(desktopViews[view].titleKey)}</div>
      <div className="min-w-0 flex-1 [--wails-draggable:drag]" />
      {actions}
    </header>
  )
}
