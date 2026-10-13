import { useTranslation } from "react-i18next"
import { Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSystemConfig } from "@/contexts/system-config-context"
import { useUpdateCheck } from "@/hooks/use-update-check"
import { appVersion, getCurrentYear } from "@/lib/app-metadata"
import { DEFAULT_BRAND_LOGO, DEFAULT_BRAND_NAME } from "@/lib/brand"

export function AccountAbout() {
  const { t } = useTranslation("accountSettings")
  const { t: tUpdate } = useTranslation("headerActions")
  const { config } = useSystemConfig()
  const { checking, lastResult: result, checkForUpdates, copyUpgradeCommand } = useUpdateCheck(tUpdate, { auto: false })
  const name = config?.system_name || DEFAULT_BRAND_NAME
  return (
    <div className="flex flex-1 items-center justify-center pt-4 pb-12 text-center">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <img src={config?.system_logo || DEFAULT_BRAND_LOGO} alt={name} className="size-16 object-contain" />
          <div className="space-y-1">
            <h4 className="text-2xl font-semibold tracking-tight">{name}</h4>
            <p className="text-sm text-muted-foreground">{appVersion}</p>
          </div>
        </div>
        <section className="space-y-4" aria-labelledby="about-update-title">
          <h4 id="about-update-title" className="text-sm font-medium">{t("aboutUpdateTitle")}</h4>
          <p className="text-sm leading-relaxed text-muted-foreground" role="status">
            {t(checking ? "aboutUpdateCheckingDescription" : result?.has_update ? "aboutUpdateAvailableDescription" : result ? "aboutUpdateLatestDescription" : "aboutUpdateIdleDescription", { version: result?.has_update ? result.latest_version : result?.current_version || appVersion })}
          </p>
          <Button variant="outline" disabled={checking} onClick={() => void checkForUpdates()}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("aboutUpdateCheckButton")}
          </Button>
          {result?.has_update && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => void copyUpgradeCommand()}><Copy />{t("aboutUpdateCopyCommandButton")}</Button>
              {result.release_url && <Button variant="outline" onClick={() => window.open(result.release_url, "_blank", "noopener,noreferrer")}><ExternalLink />{t("aboutUpdateViewReleaseButton")}</Button>}
            </div>
          )}
        </section>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("aboutFooterCopyright", { name, year: getCurrentYear() })}</p>
      </div>
    </div>
  )
}
