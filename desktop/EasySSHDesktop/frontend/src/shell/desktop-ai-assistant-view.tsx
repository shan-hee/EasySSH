import { AIWorkspace } from "@easyssh/app/workbench/ai-workspace"
import type { Locale } from "@easyssh/app/i18n"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopAIAssistantView({
  adapters,
  locale,
  active,
}: {
  adapters: DesktopAIAssistantAdapters
  locale: Locale
  active: boolean
}) {
  return (
    <DesktopWebViewShell locale={locale}>
      <DesktopPageContent scrollable={false}>
        <AIWorkspace
          active={active}
          hidePageHeader
          adapters={adapters}
        />
      </DesktopPageContent>
    </DesktopWebViewShell>
  )
}
