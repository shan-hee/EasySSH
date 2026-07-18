import { useMemo, type ReactNode } from "react"
import { BackupRestoreTab } from "@easyssh/ssh-workspace/desktop"
import type { Locale } from "@/i18n"
import { createDesktopBackupRestoreAdapter } from "../adapters/desktop-backup-restore-api"
import { useTranslation } from "react-i18next"
import { DesktopPageContent, DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopBackupRestoreView({
  locale,
  onReturnToTerminal,
  headerActions,
}: {
  locale: Locale
  onReturnToTerminal: () => void
  headerActions?: ReactNode
}) {
  const { t } = useTranslation("desktop")
  const adapter = useMemo(() => createDesktopBackupRestoreAdapter(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopReturnHeader title={t("backupRestoreLabel")} onReturnToTerminal={onReturnToTerminal} actions={headerActions} />
        <DesktopPageContent>
          <BackupRestoreTab adapter={adapter} desktopMode />
        </DesktopPageContent>
      </div>
    </DesktopWebViewShell>
  )
}
