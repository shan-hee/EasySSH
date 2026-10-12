import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { SyncPanel } from "@/components/settings/sync-panel"
import type { Locale } from "@/i18n"
import { desktopSyncAdapter } from "../adapters/desktop-sync"
import { DesktopPageContent, DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopSyncView({ locale, onReturnToTerminal, headerActions }: {
  locale: Locale
  onReturnToTerminal: () => void
  headerActions?: ReactNode
}) {
  const { t } = useTranslation("desktop")
  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopReturnHeader title={t("syncSettingsLabel")} onReturnToTerminal={onReturnToTerminal} actions={headerActions} />
        <DesktopPageContent>
          <div className="min-w-0 p-4"><SyncPanel adapter={desktopSyncAdapter} desktopMode /></div>
        </DesktopPageContent>
      </div>
    </DesktopWebViewShell>
  )
}
