
import { SettingsSection } from "@/components/settings/settings-section"
import { FormTextarea, FormSwitch, FormInput } from "@/components/settings/form-field"
import { Archive, Download, HardDrive, Loader2, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { fileTransferSchema } from "@/schemas/settings/system-config.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { useTranslation } from "react-i18next"

export function FileTransferTab() {
  const { t: tCommon } = useTranslation("common")
  const { form, isLoading, isSaving, handleSave, reload } = useSettingsForm({
    schema: fileTransferSchema,
    loadFn: async () => {
      const data = await settingsApi.getSystemConfig()
      return {
        default_download_mode: "fast" as const,
        download_exclude_patterns: data.download_exclude_patterns || "",
        skip_excluded_on_upload: data.skip_excluded_on_upload ?? true,
        max_file_upload_size: data.max_file_upload_size ?? 100,
        transfer_storage_path: data.transfer_storage_path || "",
        transfer_retention_days: data.transfer_retention_days ?? 3,
        transfer_max_storage_gb: data.transfer_max_storage_gb ?? 10,
        transfer_max_concurrency: data.transfer_max_concurrency ?? 2,
        transfer_cleanup_enabled: data.transfer_cleanup_enabled ?? true,
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveFileTransferConfig({
        ...data,
        default_download_mode: "fast",
      })
    },
  })

  if (isLoading) {
    return <SettingsLoading />
  }

  // 计算排除规则数量
  const excludePatterns = form.watch("download_exclude_patterns") || ""
  const patternCount = excludePatterns.split("\n").filter(p => p.trim()).length

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-4">
        <div className="space-y-4">
          <SettingsSection
            title="会话传输"
            description="终端或 SFTP 面板内的上传下载跟随当前连接生命周期。"
            icon={<Download className="h-5 w-5" />}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <FormInput
                form={form}
                name="max_file_upload_size"
                label="单文件上传上限"
                description="单位 MB，同时作为后台暂存上传的单文件限制。"
                type="number"
                min={1}
                max={1024}
                step={1}
                required
              />

              <FormSwitch
                form={form}
                name="skip_excluded_on_upload"
                label="上传时跳过排除项"
                description="目录上传时应用下方排除规则。"
              />

              <FormTextarea
                form={form}
                name="download_exclude_patterns"
                label={`下载/上传排除规则（${patternCount} 条）`}
                description="每行一个模式，用于目录下载和目录上传过滤。"
                rows={10}
                placeholder={"node_modules\n.git\ndist\nbuild"}
                required
                className="lg:col-span-2"
              />
            </div>
          </SettingsSection>

          <SettingsSection
            title="后台暂存"
            description="后台上传会先写入 EasySSH 存储；后台下载完成后也会生成可下载产物。"
            icon={<HardDrive className="h-5 w-5" />}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <FormInput
                form={form}
                name="transfer_storage_path"
                label="存储目录"
                description="留空时使用运行时数据目录下的 transfers。"
                placeholder="/var/lib/easyssh/transfers"
              />

              <FormInput
                form={form}
                name="transfer_max_storage_gb"
                label="最大占用"
                description="单位 GB。达到上限后拒绝新的后台暂存。"
                type="number"
                min={1}
                max={1024}
                step={1}
                required
              />

              <FormInput
                form={form}
                name="transfer_retention_days"
                label="保留天数"
                description="后台下载产物和一次性后台上传暂存文件的默认保留时间；定时上传暂存文件随任务删除或替换清理。"
                type="number"
                min={1}
                max={30}
                step={1}
                required
              />

              <FormInput
                form={form}
                name="transfer_max_concurrency"
                label="后台并发"
                description="服务端同时执行的后台传输数量，保存后重启 EasySSH 服务生效。"
                type="number"
                min={1}
                max={16}
                step={1}
                required
              />
            </div>
          </SettingsSection>

          <SettingsSection
            title="清理策略"
            description="定期清理过期的后台传输产物，释放 EasySSH 服务端存储空间。"
            icon={<Archive className="h-5 w-5" />}
          >
            <FormSwitch
              form={form}
              name="transfer_cleanup_enabled"
              label="自动清理过期产物"
              description="关闭后仍会标记过期任务，但不会主动删除本地文件。"
            />
          </SettingsSection>
        </div>
      </div>

      <div className="shrink-0 flex justify-end gap-2 p-4 bg-background">
        <Button variant="outline" onClick={reload} disabled={isSaving}>
          <RotateCcw className="mr-2 h-4 w-4" />
          {tCommon("reset")}
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {tCommon("saving")}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {tCommon("save")}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
