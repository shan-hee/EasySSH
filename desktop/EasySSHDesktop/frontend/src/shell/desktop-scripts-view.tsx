import type { ComponentProps } from "react"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import { ScriptsPage, type ScriptsPageAdapters } from "@easyssh/ssh-workspace/desktop"

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

export function DesktopScriptsView({
  adapters,
  onReturnToTerminal,
}: {
  adapters: ScriptsPageAdapters
  onReturnToTerminal: () => void
}) {
  return (
    <ClientAuthProvider initialUser={desktopUser}>
      <DashboardI18nProvider>
        <section className="easyssh-desktop-scripts-view">
          <ScriptsPage
            adapters={adapters}
            hidePageHeader
            ready
            executionRedirectPath={null}
            onReturnToTerminal={onReturnToTerminal}
          />
        </section>
      </DashboardI18nProvider>
    </ClientAuthProvider>
  )
}
