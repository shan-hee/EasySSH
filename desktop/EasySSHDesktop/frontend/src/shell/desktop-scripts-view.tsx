import type { Locale } from "@/i18n"
import { ScriptsPage, type ScriptsPageAdapters } from "@easyssh/ssh-workspace/desktop"
import { DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopScriptsView({
  adapters,
  locale,
  onReturnToTerminal,
}: {
  adapters: ScriptsPageAdapters
  locale: Locale
  onReturnToTerminal: () => void
}) {
  return (
    <DesktopWebViewShell locale={locale}>
      <ScriptsPage
        adapters={adapters}
        hidePageHeader
        desktopMode
        ready
        executionRedirectPath={null}
        onReturnToTerminal={onReturnToTerminal}
      />
    </DesktopWebViewShell>
  )
}
