import { useTranslation } from "react-i18next"
import { Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSystemConfig } from "@/contexts/system-config-context"
import { useUpdateCheck } from "@/hooks/use-update-check"
import { appVersion, getCurrentYear } from "@/lib/app-metadata"
import { DEFAULT_BRAND_LOGO, DEFAULT_BRAND_NAME } from "@/lib/brand"
import { SettingsSection } from "./settings-section"

export function AccountAbout() {
  const { t } = useTranslation("accountSettings")
  const { t: tUpdate } = useTranslation("headerActions")
  const { config } = useSystemConfig()
  const { checking, lastResult: result, checkForUpdates, copyUpgradeCommand } = useUpdateCheck(tUpdate, { auto: false })
  const name = config?.system_name || DEFAULT_BRAND_NAME
  return <div className="space-y-8">
    <div className="flex items-center gap-4"><img src={config?.system_logo || DEFAULT_BRAND_LOGO} alt={name} className="size-12" /><div><h4 className="text-xl font-semibold">{name}</h4><p className="text-sm text-muted-foreground">{appVersion}</p></div></div>
    <SettingsSection title={t("aboutUpdateTitle")}>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t(checking ? "aboutUpdateCheckingDescription" : result?.has_update ? "aboutUpdateAvailableDescription" : result ? "aboutUpdateLatestDescription" : "aboutUpdateIdleDescription", { version: result?.has_update ? result.latest_version : result?.current_version || appVersion })}</p><Button variant="outline" disabled={checking} onClick={() => void checkForUpdates()}>{checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}{t("aboutUpdateCheckButton")}</Button></div>
      {result?.has_update && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void copyUpgradeCommand()}><Copy />{t("aboutUpdateCopyCommandButton")}</Button>{result.release_url && <Button variant="outline" onClick={() => window.open(result.release_url, "_blank", "noopener,noreferrer")}><ExternalLink />{t("aboutUpdateViewReleaseButton")}</Button>}</div>}
    </SettingsSection>
    <p className="text-xs text-muted-foreground">{t("aboutFooterCopyright", { name, year: getCurrentYear() })}</p>
  </div>
}
