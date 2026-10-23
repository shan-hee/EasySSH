import { useMemo } from "react"

import { TaskCenterView } from "@/components/task-center/task-center-view"
import type { Locale } from "@/i18n"
import { createDesktopTaskCenterApi, subscribeDesktopTaskEvents } from "../adapters/desktop-task-center-api"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopTaskCenterView({
  locale,
  requestedRunID,
  onClearRequestedRun,
}: {
  locale: Locale
  requestedRunID: string | null
  onClearRequestedRun: () => void
}) {
  const api = useMemo(() => createDesktopTaskCenterApi(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopPageContent className="pt-4">
          <TaskCenterView
            api={api}
            subscribeEvents={subscribeDesktopTaskEvents}
            hidePageHeader
            requestedRunID={requestedRunID}
            onClearRequestedRun={onClearRequestedRun}
          />
        </DesktopPageContent>
      </div>
    </DesktopWebViewShell>
  )
}
