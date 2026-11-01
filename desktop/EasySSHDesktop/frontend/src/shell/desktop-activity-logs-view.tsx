import { ActivityOverview, type OverviewInput } from "@easyssh/app/components/activity/activity-overview"
import { ActivityLogService, DesktopActivityOverviewRequest } from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"
const overview = (input: OverviewInput) => ActivityLogService.GetOverview(DesktopActivityOverviewRequest.createFrom(input))
import * as React from "react"
import { LogsClient } from "@easyssh/app/desktop"
import type { Locale } from "@easyssh/app/i18n"
import { createDesktopLogsApi } from "../adapters/desktop-logs-api"
import { createDesktopServerApi } from "../adapters/desktop-server-api"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopActivityLogsView({
  locale,
}: {
  locale: Locale
}) {
  const logsApi = React.useMemo(() => createDesktopLogsApi(), [])
  const serverApi = React.useMemo(() => createDesktopServerApi(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopPageContent className="pt-4">
          <LogsClient
            api={logsApi}
            servers={serverApi}
            desktopMode
            overview={({ server }) => <ActivityOverview load={overview} scope="desktop" server={server} />}
          />
        </DesktopPageContent>
      </div>
    </DesktopWebViewShell>
  )
}
