import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
import { FormTextarea, FormSwitch, FormInput } from "@/components/settings/form-field"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { fileTransferSchema } from "@/schemas/settings/system-config.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { useSystemConfig } from "@/contexts/system-config-context"

export function FileTransferTab() {
  const { refreshConfig } = useSystemConfig()
  const { form, isLoading, isSaving, handleSave } = useSettingsForm({
    cacheKey: "file-transfer", schema: fileTransferSchema,
    loadFn: async () => {
      const data = await settingsApi.getSystemConfig()
      return { default_download_mode: "fast" as const, download_exclude_patterns: data.download_exclude_patterns || "",
        skip_excluded_on_upload: data.skip_excluded_on_upload ?? true, max_file_upload_size: data.max_file_upload_size ?? 100 }
    },
    saveFn: async (data) => { await settingsApi.saveFileTransferConfig(data); await refreshConfig() },
  })
  if (isLoading) return <SettingsLoading />
  return <div className="space-y-6 p-4">
    <SettingsSection title="客户端文件传输" description="文件通过当前设备的 SSH 连接传输。关闭页面、锁定工作区或断开连接会中止任务。">
      <p className="text-sm text-muted-foreground">浏览器单次下载和打包下载合计上限为 256 MiB，文本编辑上限为 8 MiB。较大文件请使用桌面端。服务器不暂存文件，也不运行无人值守传输。</p>
      <FormInput form={form} name="max_file_upload_size" label="单文件上传上限（MB）" type="number" min={1} max={1024} />
      <FormSwitch form={form} name="skip_excluded_on_upload" label="上传时跳过排除项" />
      <FormTextarea form={form} name="download_exclude_patterns" label="文件排除规则（每行一条）" />
    </SettingsSection>
    <SettingsFormActions visible={form.formState.isDirty} isSaving={isSaving} onReset={() => form.reset()} onSave={handleSave} />
  </div>
}
