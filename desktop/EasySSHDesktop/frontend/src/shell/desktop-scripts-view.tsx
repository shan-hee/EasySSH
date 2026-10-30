import type { Locale } from "@easyssh/app/i18n"
import { ScriptsPage, type ScriptsPageAdapters } from "@easyssh/app/desktop"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopScriptsView({
  adapters,
  locale,
}: {
  adapters: ScriptsPageAdapters
  locale: Locale
}) {
  return (
    <DesktopWebViewShell locale={locale}>

      <DesktopPageContent className="pt-4">
        <ScriptsPage
          adapters={adapters}
          hidePageHeader
          desktopMode
          ready
          executionRedirectPath={null}
        />
      </DesktopPageContent>
    </DesktopWebViewShell>
  )
}
