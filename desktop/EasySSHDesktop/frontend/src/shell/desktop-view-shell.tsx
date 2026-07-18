import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowLeft,
  DEFAULT_SYSTEM_CONFIG,
  StaticSystemConfigProvider,
} from "@easyssh/ssh-workspace/desktop"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { Button } from "@/components/ui/button"
import type { Locale } from "@/i18n"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import {
  DESKTOP_LOCAL_EMAIL,
  DESKTOP_LOCAL_OWNER_ID,
  DESKTOP_LOCAL_TIMEZONE,
  DESKTOP_LOCAL_USERNAME,
} from "../adapters/desktop-local-identity"

function createDesktopUser(locale: Locale) {
  // Desktop has no Web account system. This local owner object only satisfies
  // shared Dashboard component context while preserving single-user semantics.
  return {
    id: DESKTOP_LOCAL_OWNER_ID,
    username: DESKTOP_LOCAL_USERNAME,
    email: DESKTOP_LOCAL_EMAIL,
    role: "owner",
    language: locale,
    timezone: DESKTOP_LOCAL_TIMEZONE,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
}

export function DesktopWebViewShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const user = createDesktopUser(locale)
  return (
    <StaticSystemConfigProvider
      config={DEFAULT_SYSTEM_CONFIG}
      authStatus={{
        need_init: false,
        is_authenticated: true,
        user,
        system_config: DEFAULT_SYSTEM_CONFIG,
        access_token_ttl_seconds: 0,
      }}
    >
      <ClientAuthProvider key={locale}>
        <DashboardI18nProvider>
          <section className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            {children}
          </section>
        </DashboardI18nProvider>
      </ClientAuthProvider>
    </StaticSystemConfigProvider>
  )
}

export function DesktopReturnHeader({
  title,
  onReturnToTerminal,
  actions,
}: {
  title: string
  onReturnToTerminal: () => void
  actions?: ReactNode
}) {
  const { t } = useTranslation("desktop")

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background/65 pl-3 backdrop-blur-md [--wails-draggable:drag]">
      <Button variant="ghost" size="sm" className="h-8 [--wails-draggable:no-drag]" onClick={onReturnToTerminal}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("returnToTerminalLabel")}
      </Button>
      <div className="min-w-0 truncate text-sm font-medium">{title}</div>
      <div className="min-w-0 flex-1 [--wails-draggable:drag]" />
      {actions}
    </div>
  )
}
