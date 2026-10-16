import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { AccountSSHKeys } from "@/components/settings/account-ssh-keys"
import type { Locale } from "@/i18n"
import { desktopSSHKeyApi } from "../adapters/desktop-server-api"
import { DesktopPageContent, DesktopReturnHeader, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopSSHKeysView({ locale, onReturnToTerminal, headerActions }: {
  locale: Locale
  onReturnToTerminal: () => void
  headerActions?: ReactNode
}) {
  const { t } = useTranslation("desktop")
  return (
    <DesktopWebViewShell locale={locale}>
      <DesktopReturnHeader title={t("keyPairsLabel")} onReturnToTerminal={onReturnToTerminal} actions={headerActions} />
      <DesktopPageContent>
        <div className="min-w-0 p-4"><AccountSSHKeys api={desktopSSHKeyApi} /></div>
      </DesktopPageContent>
    </DesktopWebViewShell>
  )
}
