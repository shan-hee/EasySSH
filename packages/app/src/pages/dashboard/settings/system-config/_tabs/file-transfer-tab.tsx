import { useTranslation } from "react-i18next"
import { SettingsSection } from "@/components/settings/settings-section"
import { FormTextarea, FormSwitch, FormInput } from "@/components/settings/form-field"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { fileTransferSchema } from "@/schemas/settings/system-config.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { useSystemConfig } from "@/contexts/system-config-context"

export function FileTransferTab() {
  const { t } = useTranslation("settingsSystemFileTransfer")
  const { refreshConfig } = useSystemConfig()
  const { form, isLoading } = useSettingsForm({
    cacheKey: "file-transfer",
    schema: fileTransferSchema,
    loadFn: async () => {
      const data = await settingsApi.getSystemConfig()
      return {
        download_exclude_patterns: data.download_exclude_patterns,
        skip_excluded_on_upload: data.skip_excluded_on_upload,
        max_file_upload_size: data.max_file_upload_size,
        transfer_storage_path: data.transfer_storage_path,
        transfer_retention_days: data.transfer_retention_days,
        transfer_max_storage_gb: data.transfer_max_storage_gb,
        transfer_max_concurrency: data.transfer_max_concurrency,
        transfer_max_entries: data.transfer_max_entries,
        transfer_max_depth: data.transfer_max_depth,
        transfer_cleanup_enabled: data.transfer_cleanup_enabled,
        sftp_max_idle_time_seconds: data.sftp_max_idle_time_seconds,
        sftp_cleanup_interval_seconds: data.sftp_cleanup_interval_seconds,
        sftp_max_life_time_minutes: data.sftp_max_life_time_minutes,
        sftp_conn_timeout_seconds: data.sftp_conn_timeout_seconds,
        sftp_max_sessions_per_conn: data.sftp_max_sessions_per_conn,
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveFileTransferConfig(data)
      await refreshConfig()
    },
  })

  if (isLoading) {
    return <SettingsLoading />
  }

  const patternCount = (form.watch("download_exclude_patterns") || "").split("\n").filter(pattern => pattern.trim()).length

  return (
    <div className="space-y-6 p-4">
      <SettingsSection title={t("sessionTitle")} description={t("sessionDescription")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <FormInput form={form} name="max_file_upload_size" label={t("maxUploadSize")} description={t("maxUploadSizeDesc")} type="number" min={1} max={1024} step={1} required />
          <FormSwitch form={form} name="skip_excluded_on_upload" label={t("skipExcluded")} description={t("skipExcludedDesc")} className="self-end" />
        </div>
        <FormTextarea form={form} name="download_exclude_patterns" label={t("excludePatterns", { count: patternCount })} description={t("excludePatternsDesc")} rows={6} placeholder={"node_modules\n.git\ndist\nbuild"} required />
      </SettingsSection>

      <div className="border-t" />

      <SettingsSection title={t("storageTitle")} description={t("storageDescription")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <FormInput form={form} name="transfer_storage_path" label={t("storagePath")} description={t("storagePathDesc")} placeholder="/var/lib/easyssh/transfers" />
          <FormInput form={form} name="transfer_max_storage_gb" label={t("maxStorage")} description={t("maxStorageDesc")} type="number" min={1} max={1024} step={1} required />
          <FormInput form={form} name="transfer_retention_days" label={t("retentionDays")} description={t("retentionDaysDesc")} type="number" min={1} max={30} step={1} required />
          <FormInput form={form} name="transfer_max_concurrency" label={t("transferConcurrency")} description={t("transferConcurrencyDesc")} type="number" min={1} max={16} step={1} required />
          <FormInput form={form} name="transfer_max_entries" label={t("maxEntries")} description={t("maxEntriesDesc")} type="number" min={1} step={1} required />
          <FormInput form={form} name="transfer_max_depth" label={t("maxDepth")} description={t("maxDepthDesc")} type="number" min={1} step={1} required />
        </div>
        <FormSwitch form={form} name="transfer_cleanup_enabled" label={t("cleanupEnabled")} description={t("cleanupEnabledDesc")} />
        <p className="text-xs text-muted-foreground">{t("scheduledStagingNote")}</p>
      </SettingsSection>

      <div className="border-t" />

      <SettingsSection title={t("poolTitle")} description={t("poolDescription")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <FormInput form={form} name="sftp_max_idle_time_seconds" label={t("idleTime")} description={t("idleTimeDesc")} type="number" min={5} max={3600} />
          <FormInput form={form} name="sftp_cleanup_interval_seconds" label={t("cleanupInterval")} description={t("cleanupIntervalDesc")} type="number" min={5} max={600} />
          <FormInput form={form} name="sftp_max_life_time_minutes" label={t("maxLifetime")} description={t("maxLifetimeDesc")} type="number" min={0} max={1440} />
          <FormInput form={form} name="sftp_conn_timeout_seconds" label={t("connTimeout")} description={t("connTimeoutDesc")} type="number" min={1} max={120} />
          <FormInput form={form} name="sftp_max_sessions_per_conn" label={t("maxSessions")} description={t("maxSessionsDesc")} type="number" min={0} max={64} />
        </div>
      </SettingsSection>
    </div>
  )
}
