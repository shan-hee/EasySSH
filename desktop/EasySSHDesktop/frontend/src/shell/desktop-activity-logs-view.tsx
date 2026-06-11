import * as React from "react"
import type { ComponentProps } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ClientAuthProvider } from "@/components/client-auth-provider"
import { LogsClient } from "@/pages/dashboard/logs/components/logs-client"
import type { Locale } from "@/i18n"
import { DashboardI18nProvider } from "@/providers/dashboard-i18n-provider"
import { createDesktopLogsApi } from "../adapters/desktop-logs-api"
import { useTranslation } from "react-i18next"

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

export function DesktopActivityLogsView({
  locale,
  onReturnToTerminal,
}: {
  locale: Locale
  onReturnToTerminal: () => void
}) {
  const { t } = useTranslation("desktop")
  const logsApi = React.useMemo(() => createDesktopLogsApi(), [])

  return (
    <ClientAuthProvider key={locale} initialUser={createDesktopUser(locale)}>
      <DashboardI18nProvider>
        <section className="easyssh-desktop-logs-view">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <Button variant="ghost" size="sm" className="h-8" onClick={onReturnToTerminal}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("returnToTerminalLabel")}
              </Button>
              <div className="min-w-0 truncate text-sm font-medium">{t("activityLogLabel")}</div>
            </div>
            <LogsClient api={logsApi} />
          </div>
        </section>
      </DashboardI18nProvider>
    </ClientAuthProvider>
  )
}
