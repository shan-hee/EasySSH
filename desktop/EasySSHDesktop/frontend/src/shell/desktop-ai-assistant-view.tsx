import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { AIAssistantWorkspaceView } from "@/components/ai-agent/ai-assistant-workspace-view"
import type { Locale } from "@/i18n"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"
import { DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopAIAssistantView({
  adapters,
  locale,
  onReturnToTerminal,
  headerActions,
}: {
  adapters: DesktopAIAssistantAdapters
  locale: Locale
  onReturnToTerminal: () => void
  headerActions?: ReactNode
}) {
  const { t } = useTranslation("desktop")

  return (
    <DesktopWebViewShell locale={locale}>
      <DesktopReturnHeader title={t("aiAssistantLabel")} onReturnToTerminal={onReturnToTerminal} actions={headerActions} />
      <AIAssistantWorkspaceView
        hidePageHeader
        customConfigOnly
        adapters={adapters}
      />
    </DesktopWebViewShell>
  )
}
