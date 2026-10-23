import { AccountSSHKeys } from "@/components/settings/account-ssh-keys"
import type { Locale } from "@/i18n"
import { desktopSSHKeyApi } from "../adapters/desktop-server-api"
import { DesktopPageContent, DesktopWebViewShell } from "./desktop-view-shell"

export function DesktopSSHKeysView({ locale }: {
  locale: Locale
}) {
  return (
    <DesktopWebViewShell locale={locale}>

      <DesktopPageContent>
        <div className="min-w-0 p-4"><AccountSSHKeys api={desktopSSHKeyApi} /></div>
      </DesktopPageContent>
    </DesktopWebViewShell>
  )
}
