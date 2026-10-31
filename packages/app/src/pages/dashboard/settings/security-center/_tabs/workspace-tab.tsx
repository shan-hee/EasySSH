import { useTranslation } from "react-i18next"
import { settingsApi } from "@/lib/api/settings"
import { workspaceConfigSchema } from "@/schemas/settings/security.schema"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { FormInput, FormSwitch } from "@/components/settings/form-field"
import { useSystemConfig } from "@/contexts/system-config-context"

export function WorkspaceTab() {
  const { t } = useTranslation("settingsWorkspace")
  const { refreshConfig } = useSystemConfig()
  const { form, isLoading } = useSettingsForm({
    cacheKey: "workspace",
    schema: workspaceConfigSchema,
    loadFn: settingsApi.getWorkspaceConfig,
    saveFn: async (data) => {
      await settingsApi.saveWorkspaceConfig(data)
      await refreshConfig()
    },
  })

  if (isLoading) return <SettingsLoading />

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <FormInput form={form} name="max_tabs" label={t("maxTabs")} description={t("maxTabsDescription")} type="number" min={1} max={200} />
        <FormInput form={form} name="inactive_minutes" label={t("inactiveMinutes")} description={t("inactiveMinutesDescription")} type="number" min={5} max={1440} />
      </div>
      <FormSwitch form={form} name="hibernate" label={t("hibernate")} description={t("hibernateDescription")} />
    </div>
  )
}
