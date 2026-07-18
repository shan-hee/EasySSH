import { useMemo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { TaskCenterView } from "@/components/task-center/task-center-view"
import type { Locale } from "@/i18n"
import { createDesktopTaskCenterApi, subscribeDesktopTaskEvents } from "../adapters/desktop-task-center-api"
import { DesktopPageContent, DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopTaskCenterView({
  locale,
  requestedRunID,
  onClearRequestedRun,
  onReturnToTerminal,
  headerActions,
}: {
  locale: Locale
  requestedRunID: string | null
  onClearRequestedRun: () => void
  onReturnToTerminal: () => void
  headerActions?: ReactNode
}) {
  const { t } = useTranslation("taskCenter")
  const api = useMemo(() => createDesktopTaskCenterApi(), [])

  return (
    <DesktopWebViewShell locale={locale}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DesktopReturnHeader title={t("title")} onReturnToTerminal={onReturnToTerminal} actions={headerActions} />
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
