import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { TaskCenterView } from "@/components/task-center/task-center-view"
import type { Locale } from "@/i18n"
import { createDesktopTaskCenterApi, subscribeDesktopTaskEvents } from "../adapters/desktop-task-center-api"
import { DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopTaskCenterView({
  locale,
  requestedRunID,
  onClearRequestedRun,
  onReturnToTerminal,
}: {
  locale: Locale
  requestedRunID: string | null
  onClearRequestedRun: () => void
  onReturnToTerminal: () => void
}) {
  const { t } = useTranslation("taskCenter")
  const api = useMemo(() => createDesktopTaskCenterApi(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopReturnHeader title={t("title")} onReturnToTerminal={onReturnToTerminal} />
        <TaskCenterView
          api={api}
          subscribeEvents={subscribeDesktopTaskEvents}
          hidePageHeader
          requestedRunID={requestedRunID}
          onClearRequestedRun={onClearRequestedRun}
        />
      </div>
    </DesktopWebViewShell>
  )
}
