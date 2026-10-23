import { SyncPanel } from "@/components/settings/sync-panel"
import type { Locale } from "@/i18n"
import { desktopSyncAdapter } from "../adapters/desktop-sync"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopSyncView({ locale }: {
  locale: Locale
}) {
  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopPageContent>
          <div className="min-w-0 p-4"><SyncPanel adapter={desktopSyncAdapter} desktopMode /></div>
        </DesktopPageContent>
      </div>
    </DesktopWebViewShell>
  )
}
