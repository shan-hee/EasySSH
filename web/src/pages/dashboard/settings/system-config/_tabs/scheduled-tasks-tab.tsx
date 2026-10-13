import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Activity, Clock3, Gauge, Info, ListTodo } from "lucide-react"
import { useTranslation } from "react-i18next"
import { FormInput } from "@/components/settings/form-field"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
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
  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
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

  return (
    <div className="flex flex-col p-4">
      <div className="space-y-6">
        <SettingsSection
          title={t("runtimeTitle")}
          description={t("runtimeDescription")}
          icon={<Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <RuntimeMetric
              icon={Clock3}
              label={t("dispatchMode")}
              value={t("dispatchModeOnDemand")}
            />
            <RuntimeMetric
              icon={Gauge}
              label={t("activeJobs")}
              value={status ? `${status.active} / ${status.max_concurrency}` : "-"}
            />
            <RuntimeMetric
              icon={ListTodo}
              label={t("queuedJobs")}
              value={status ? String(status.queued) : "-"}
            />
            <RuntimeMetric
              icon={Activity}
              label={t("runtimeState")}
              value={status ? (status.scaling_down ? t("stateScalingDown") : t("stateReady")) : "-"}
            />
          </div>
        </SettingsSection>

        <div className="border-t" />

        <SettingsSection
          title={t("concurrencyTitle")}
          description={t("concurrencyDescription")}
          icon={<Gauge className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
          actions={(
            <SettingsFormActions
              visible={isDirty}
              isSaving={isSaving}
              onReset={reset}
              onSave={handleSave}
            />
          )}
        >
          <div className="max-w-xl">
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
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t("concurrencyHint")}</p>
          </div>
          {status?.scaling_down && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{t("scalingDownHint", { active: status.active, max: status.max_concurrency })}</p>
            </div>
          )}
        </SettingsSection>
      </div>
    </div>
  )
}

function RuntimeMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
