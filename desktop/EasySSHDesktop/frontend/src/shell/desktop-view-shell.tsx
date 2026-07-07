import type { ComponentProps, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "@easyssh/ssh-workspace/desktop"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { Button } from "@/components/ui/button"
import type { Locale } from "@/i18n"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"

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

export function DesktopWebViewShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <ClientAuthProvider key={locale} initialUser={createDesktopUser(locale)}>
      <DashboardI18nProvider>
        <section className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {children}
        </section>
      </DashboardI18nProvider>
    </ClientAuthProvider>
  )
}

export function DesktopReturnHeader({
  title,
  onReturnToTerminal,
}: {
  title: string
  onReturnToTerminal: () => void
}) {
  const { t } = useTranslation("desktop")

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      <Button variant="ghost" size="sm" className="h-8" onClick={onReturnToTerminal}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("returnToTerminalLabel")}
      </Button>
      <div className="min-w-0 truncate text-sm font-medium">{title}</div>
    </div>
  )
}
