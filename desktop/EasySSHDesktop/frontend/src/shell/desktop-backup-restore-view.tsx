import { useMemo } from "react"
import { BackupRestoreTab } from "@easyssh/app/desktop"
import { RetentionPanel } from "@easyssh/app/components/settings/retention-panel"
import type { Locale } from "@easyssh/app/i18n"
import { createDesktopBackupRestoreAdapter } from "../adapters/desktop-backup-restore-api"
import { desktopRetentionAdapter } from "../adapters/desktop-retention"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopBackupRestoreView({
  locale,
}: {
  locale: Locale
}) {
  const adapter = useMemo(() => createDesktopBackupRestoreAdapter(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopPageContent>
          <BackupRestoreTab adapter={adapter} />
          <div className="mt-6 border-t pt-2">
            <RetentionPanel adapter={desktopRetentionAdapter} />
          </div>
        </DesktopPageContent>
      </div>
    </DesktopWebViewShell>
  )
}
