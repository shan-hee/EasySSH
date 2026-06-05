import AIAssistantPage from "@/pages/dashboard/ai-assistant-page"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import { QueryProvider } from "@/providers/query-provider"
import type { User } from "@/lib/api/auth"
import type { DesktopAIAssistantAdapters } from "../adapters/desktop-ai-adapters"

const desktopUser: User = {
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
    <QueryProvider>
      <ClientAuthProvider initialUser={desktopUser}>
        <DashboardI18nProvider>
          <section className="easyssh-desktop-ai-view">
            <AIAssistantPage
              hidePageHeader
              customConfigOnly
              onReturnToTerminal={onReturnToTerminal}
              adapters={adapters}
            />
          </section>
        </DashboardI18nProvider>
      </ClientAuthProvider>
    </QueryProvider>
  )
}
