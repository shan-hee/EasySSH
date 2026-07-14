import { useTranslation } from "react-i18next"
import {
  DEFAULT_SYSTEM_CONFIG,
  useSystemConfig,
} from "@/contexts/system-config-context"
import { appVersion, getCurrentYear } from "@/lib/app-metadata"

export function AuthPageFooter() {
  const { config } = useSystemConfig()
  const { t } = useTranslation("auth")
  const systemName = config?.system_name?.trim() || DEFAULT_SYSTEM_CONFIG.system_name
  const items = [
    systemName,
    appVersion ? `v${appVersion}` : null,
    t("authFooterCopyright", { year: getCurrentYear() }),
  ].filter((item): item is string => Boolean(item))

  return (
    <div className="text-center text-xs text-zinc-500 dark:text-zinc-600">
      {items.join(" | ")}
    </div>
  )
}
