import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { Locale } from "@/i18n"
import { ScriptsPage, type ScriptsPageAdapters } from "@easyssh/ssh-workspace/desktop"
import { DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopScriptsView({
  adapters,
  locale,
  onReturnToTerminal,
  headerActions,
}: {
  adapters: ScriptsPageAdapters
  locale: Locale
  onReturnToTerminal: () => void
  headerActions?: ReactNode
}) {
  const { t } = useTranslation("desktop")

  return (
    <DesktopWebViewShell locale={locale}>
      <DesktopReturnHeader title={t("scriptLibraryLabel")} onReturnToTerminal={onReturnToTerminal} actions={headerActions} />
      <ScriptsPage
        adapters={adapters}
        hidePageHeader
        desktopMode
        ready
        executionRedirectPath={null}
      />
    </DesktopWebViewShell>
  )
}
