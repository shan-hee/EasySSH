import type { ReactNode } from "react"
import {
  DEFAULT_SYSTEM_CONFIG,
  StaticSystemConfigProvider,
} from "@easyssh/ssh-workspace/desktop"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import type { Locale } from "@/i18n"
import { cn } from "@/lib/utils"
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
          <section className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </section>
        </DashboardI18nProvider>
      </ClientAuthProvider>
    </StaticSystemConfigProvider>
  )
}

export function DesktopPageContent({
  children,
  className,
  scrollable = true,
}: {
  children: ReactNode
  className?: string
  scrollable?: boolean
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        scrollable
          ? "overflow-x-hidden overflow-y-auto scrollbar-custom [scrollbar-gutter:stable]"
          : "overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  )
}
