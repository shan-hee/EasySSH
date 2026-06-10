import type { ComponentProps } from "react"
import { AIAssistantWorkspaceView } from "@/components/ai-agent/ai-assistant-workspace-view"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import type { Locale } from "@/i18n"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"

function createDesktopUser(locale: Locale): NonNullable<ComponentProps<typeof ClientAuthProvider>["initialUser"]> {
  return {
    id: "desktop-local-owner",
    username: "desktop",
    email: "desktop@easyssh.local",
    role: "admin",
    language: locale,
    timezone: "Asia/Shanghai",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
}

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
    <ClientAuthProvider key={locale} initialUser={createDesktopUser(locale)}>
      <DashboardI18nProvider>
        <section className="easyssh-desktop-ai-view">
          <AIAssistantWorkspaceView
            hidePageHeader
            customConfigOnly
            onReturnToTerminal={onReturnToTerminal}
            adapters={adapters}
          />
        </section>
      </DashboardI18nProvider>
    </ClientAuthProvider>
  )
}
