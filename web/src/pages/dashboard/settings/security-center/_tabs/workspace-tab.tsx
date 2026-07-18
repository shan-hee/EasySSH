import { useTranslation } from "react-i18next"
import { Clock } from "lucide-react"
import { settingsApi } from "@/lib/api/settings"
import { workspaceConfigSchema } from "@/schemas/settings/security.schema"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
import { SettingsSection } from "@/components/settings/settings-section"
import { FormInput, FormSwitch } from "@/components/settings/form-field"
import { useSystemConfig } from "@/contexts/system-config-context"

export function WorkspaceTab() {
  const { t } = useTranslation("settingsWorkspace")
  const { refreshConfig } = useSystemConfig()
  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
    schema: workspaceConfigSchema,
    loadFn: settingsApi.getWorkspaceConfig,
    saveFn: async (data) => {
      await settingsApi.saveWorkspaceConfig(data)
      await refreshConfig()
    },
  })

  if (isLoading) return <SettingsLoading />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-custom">
        <SettingsSection
          title={t("title")}
          description={t("description")}
          icon={<Clock className="h-5 w-5" />}
          actions={<SettingsFormActions visible={isDirty} isSaving={isSaving} onReset={reset} onSave={handleSave} />}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <FormInput form={form} name="max_tabs" label={t("maxTabs")} description={t("maxTabsDescription")} type="number" min={1} max={200} />
            <FormInput form={form} name="inactive_minutes" label={t("inactiveMinutes")} description={t("inactiveMinutesDescription")} type="number" min={5} max={1440} />
            <FormSwitch form={form} name="hibernate" label={t("hibernate")} description={t("hibernateDescription")} />
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}
