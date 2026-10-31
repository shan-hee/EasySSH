
import { useTranslation } from "react-i18next"
import { FormTextarea } from "@/components/settings/form-field"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { networkSecuritySchema } from "@/schemas/settings/security.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"

export function AccessControlTab() {
  const { t } = useTranslation("settingsSecurityAccess")
  const { form, isLoading } = useSettingsForm({
    cacheKey: "access-control",
    schema: networkSecuritySchema,
    loadFn: async () => {
      const config = await settingsApi.getIPWhitelistConfig()
      return {
        allowlist_ips: config.allowlist_ips || "",
        blocklist_ips: config.blocklist_ips || "",
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveIPWhitelistConfig({
        allowlist_ips: data.allowlist_ips,
        blocklist_ips: data.blocklist_ips,
      })
    },
  })

  if (isLoading) {
    return <SettingsLoading />
  }

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <FormTextarea form={form} name="allowlist_ips" label={t("labelAllowlist")} description={t("helperAllowlist")} placeholder={t("placeholderAllowlist")} rows={6} />
        <FormTextarea form={form} name="blocklist_ips" label={t("labelBlocklist")} description={t("helperBlocklist")} placeholder={t("placeholderBlocklist")} rows={6} />
      </div>
      <p className="text-xs text-muted-foreground">{t("alertContent")}</p>
    </div>
  )
}
