import { useMemo } from "react"
import { BackupRestoreTab } from "@easyssh/ssh-workspace/desktop"
import type { Locale } from "@/i18n"
import { createDesktopBackupRestoreAdapter } from "../adapters/desktop-backup-restore-api"
import { useTranslation } from "react-i18next"
import { DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopBackupRestoreView({
  locale,
  onReturnToTerminal,
}: {
  locale: Locale
  onReturnToTerminal: () => void
}) {
  const { t } = useTranslation("desktop")
  const adapter = useMemo(() => createDesktopBackupRestoreAdapter(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopReturnHeader title={t("backupRestoreLabel")} onReturnToTerminal={onReturnToTerminal} />
        <BackupRestoreTab adapter={adapter} desktopMode />
      </div>
    </DesktopWebViewShell>
  )
}
