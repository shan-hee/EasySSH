import * as React from "react"
import { LogsClient } from "@easyssh/ssh-workspace/desktop"
import type { Locale } from "@/i18n"
import { createDesktopLogsApi } from "../adapters/desktop-logs-api"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopActivityLogsView({
  locale,
}: {
  locale: Locale
}) {
  const logsApi = React.useMemo(() => createDesktopLogsApi(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopPageContent className="pt-4">
          <LogsClient api={logsApi} desktopMode />
        </DesktopPageContent>
      </div>
    </DesktopWebViewShell>
  )
}
