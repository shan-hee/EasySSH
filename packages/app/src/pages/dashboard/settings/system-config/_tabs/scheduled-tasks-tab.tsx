import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { FormInput } from "@/components/settings/form-field"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { SettingsSection } from "@/components/settings/settings-section"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { settingsApi } from "@/lib/api/settings"
import { queryKeys } from "@/lib/query-keys"
import { scheduledTaskConfigSchema } from "@/schemas/settings/system-config.schema"

export function ScheduledTasksTab() {
  const { t } = useTranslation("settingsScheduledTasks")
  const { ready } = useAuthReady()
  const queryClient = useQueryClient()
  const runtimeQuery = useQuery({
    queryKey: queryKeys.settings.scheduledTaskRuntime,
    queryFn: settingsApi.getScheduledTaskSettings,
    enabled: ready,
    refetchInterval: 3_000,
  })
  const { form, isLoading } = useSettingsForm({
    cacheKey: "scheduled-tasks",
    schema: scheduledTaskConfigSchema,
    loadFn: async () => (await settingsApi.getScheduledTaskSettings()).config,
    saveFn: async (config) => {
      await settingsApi.saveScheduledTaskSettings(config)
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.scheduledTaskRuntime })
    },
  })

  if (isLoading) {
    return <SettingsLoading />
  }

  const status = runtimeQuery.data?.status
  const metrics = [
    { label: t("dispatchMode"), value: t("dispatchModeOnDemand") },
    { label: t("activeJobs"), value: status ? `${status.active} / ${status.max_concurrency}` : "-" },
    { label: t("queuedJobs"), value: status ? String(status.queued) : "-" },
    { label: t("runtimeState"), value: status ? (status.scaling_down ? t("stateScalingDown") : t("stateReady")) : "-" },
  ]

  return (
    <div className="space-y-6 p-4">
      <SettingsSection title={t("runtimeTitle")} description={t("runtimeDescription")}>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
          {metrics.map(metric => <div key={metric.label} className="bg-card p-3">
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{metric.value}</dd>
          </div>)}
        </dl>
      </SettingsSection>

      <div className="border-t" />

      <SettingsSection title={t("concurrencyTitle")} description={t("concurrencyDescription")}>
        <FormInput
          form={form}
          name="job_queue_max_concurrency"
          label={t("maxConcurrency")}
          description={t("maxConcurrencyDescription")}
          type="number"
          min={1}
          max={16}
          step={1}
          required
          className="max-w-sm"
        />
        <p className="text-xs text-muted-foreground">{t("concurrencyHint")}</p>
        {status?.scaling_down && <p className="text-xs text-amber-700 dark:text-amber-400">{t("scalingDownHint", { active: status.active, max: status.max_concurrency })}</p>}
      </SettingsSection>
    </div>
  )
}
