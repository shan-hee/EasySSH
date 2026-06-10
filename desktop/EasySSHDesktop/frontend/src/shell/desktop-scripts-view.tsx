import type { ComponentProps } from "react"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import type { Locale } from "@/i18n"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import { ScriptsPage, type ScriptsPageAdapters } from "@easyssh/ssh-workspace/desktop"

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
    <ClientAuthProvider key={locale} initialUser={createDesktopUser(locale)}>
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
