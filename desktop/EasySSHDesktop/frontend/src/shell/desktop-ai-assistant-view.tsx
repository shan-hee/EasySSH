import { AIAssistantWorkspaceView } from "@/components/ai-agent/ai-assistant-workspace-view"
import type { Locale } from "@/i18n"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"
import { DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopAIAssistantView({
  adapters,
  locale,
  onReturnToTerminal,
}: {
  adapters: DesktopAIAssistantAdapters
  locale: Locale
  onReturnToTerminal: () => void
}) {
  return (
    <DesktopWebViewShell locale={locale}>
      <AIAssistantWorkspaceView
        hidePageHeader
        customConfigOnly
        onReturnToTerminal={onReturnToTerminal}
        adapters={adapters}
      />
    </DesktopWebViewShell>
  )
}
