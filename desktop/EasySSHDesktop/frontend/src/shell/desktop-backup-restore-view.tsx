import { useMemo } from "react"
import { BackupRestoreTab } from "@easyssh/ssh-workspace/desktop"
import type { Locale } from "@/i18n"
import { createDesktopBackupRestoreAdapter } from "../adapters/desktop-backup-restore-api"
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
        </DesktopPageContent>
      </div>
    </DesktopWebViewShell>
  )
}
