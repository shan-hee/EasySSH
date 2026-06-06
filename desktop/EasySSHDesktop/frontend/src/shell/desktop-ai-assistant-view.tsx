import type { ComponentProps } from "react"
import { AIAssistantWorkspaceView } from "@/components/ai-agent/ai-assistant-workspace-view"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"

const desktopUser: NonNullable<ComponentProps<typeof ClientAuthProvider>["initialUser"]> = {
  id: "desktop-local-owner",
  username: "desktop",
  email: "desktop@easyssh.local",
  role: "admin",
  language: "zh-CN",
  timezone: "Asia/Shanghai",
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
}

export function DesktopAIAssistantView({
  adapters,
  onReturnToTerminal,
}: {
  adapters: DesktopAIAssistantAdapters
  onReturnToTerminal: () => void
}) {
  return (
    <ClientAuthProvider initialUser={desktopUser}>
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
