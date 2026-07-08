import * as React from "react"
import { LogsClient } from "@easyssh/ssh-workspace/desktop"
import type { Locale } from "@/i18n"
import { createDesktopLogsApi } from "../adapters/desktop-logs-api"
import { useTranslation } from "react-i18next"
import { DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopActivityLogsView({
  locale,
  onReturnToTerminal,
}: {
  locale: Locale
  onReturnToTerminal: () => void
}) {
  const { t } = useTranslation("desktop")
  const logsApi = React.useMemo(() => createDesktopLogsApi(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopReturnHeader title={t("activityLogLabel")} onReturnToTerminal={onReturnToTerminal} />
        <LogsClient api={logsApi} desktopMode />
      </div>
    </DesktopWebViewShell>
  )
}
