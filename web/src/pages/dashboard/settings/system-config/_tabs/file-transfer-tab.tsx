import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
import { FormTextarea, FormSwitch, FormInput } from "@/components/settings/form-field"
import { Archive, Download, HardDrive, ChevronDown, Info, Network } from "lucide-react"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { fileTransferSchema } from "@/schemas/settings/system-config.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { useState } from "react"
import { useSystemConfig } from "@/contexts/system-config-context"

export function FileTransferTab() {
  const { refreshConfig } = useSystemConfig()
  const { form, isLoading, isSaving, handleSave } = useSettingsForm({
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
        sftp_max_idle_time_seconds: data.sftp_max_idle_time_seconds ?? 120,
        sftp_cleanup_interval_seconds: data.sftp_cleanup_interval_seconds ?? 30,
        sftp_max_life_time_minutes: data.sftp_max_life_time_minutes ?? 0,
        sftp_conn_timeout_seconds: data.sftp_conn_timeout_seconds ?? 10,
        sftp_max_sessions_per_conn: data.sftp_max_sessions_per_conn ?? 8,
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveFileTransferConfig({
        ...data,
        default_download_mode: "fast",
      })
      await refreshConfig()
    },
  })

  const [isExcludePatternsOpen, setIsExcludePatternsOpen] = useState(false)

  if (isLoading) {
    return <SettingsLoading />
  }

  // 计算排除规则数量
  const excludePatterns = form.watch("download_exclude_patterns") || ""
  const patternCount = excludePatterns.split("\n").filter(p => p.trim()).length
  const dirtyFields = form.formState.dirtyFields
  const sessionTransferDirty = Boolean(
    dirtyFields.max_file_upload_size ||
    dirtyFields.skip_excluded_on_upload ||
    dirtyFields.download_exclude_patterns,
  )
  const storageDirty = Boolean(
    dirtyFields.transfer_storage_path ||
    dirtyFields.transfer_retention_days ||
    dirtyFields.transfer_max_storage_gb ||
    dirtyFields.transfer_max_concurrency,
  )
  const connectionPoolDirty = Boolean(
    dirtyFields.sftp_max_idle_time_seconds ||
    dirtyFields.sftp_cleanup_interval_seconds ||
    dirtyFields.sftp_max_life_time_minutes ||
    dirtyFields.sftp_conn_timeout_seconds ||
    dirtyFields.sftp_max_sessions_per_conn,
  )
  const cleanupDirty = Boolean(dirtyFields.transfer_cleanup_enabled)

  return (
    <div className="flex flex-col">
      <div className="p-4">
        <div className="space-y-6">
          {/* 会话传输 */}
          <SettingsSection
            title="会话传输"
            description="终端或 SFTP 面板内的上传下载跟随当前连接生命周期。"
            icon={<Download className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
            actions={<SettingsFormActions visible={sessionTransferDirty} isSaving={isSaving} onReset={() => {
              form.resetField("max_file_upload_size")
              form.resetField("skip_excluded_on_upload")
              form.resetField("download_exclude_patterns")
            }} onSave={handleSave} />}
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
            </div>

            <Separator className="my-4" />

            {/* 排除规则 - 使用折叠面板 */}
            <Collapsible
              open={isExcludePatternsOpen}
              onOpenChange={setIsExcludePatternsOpen}
              className="rounded-lg border bg-muted/30 p-4"
            >
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between text-left">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">下载/上传排除规则</h4>
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {patternCount} 条
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      每行一个模式，用于目录下载和目录上传过滤。点击展开编辑。
                    </p>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isExcludePatternsOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">
                <FormTextarea
                  form={form}
                  name="download_exclude_patterns"
                  label=""
                  rows={10}
                  placeholder={"node_modules\n.git\ndist\nbuild"}
                  required
                />
                <div className="mt-2 flex items-start gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 p-3">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-900 dark:text-blue-300">
                    常见排除项：node_modules, .git, .svn, dist, build, target, __pycache__, *.log
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </SettingsSection>

          <Separator />

          {/* 后台暂存 */}
          <SettingsSection
            title="后台暂存"
            description="后台上传会先写入 EasySSH 存储；后台下载完成后也会生成可下载产物。"
            icon={<HardDrive className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
            actions={<SettingsFormActions visible={storageDirty} isSaving={isSaving} onReset={() => {
              form.resetField("transfer_storage_path")
              form.resetField("transfer_retention_days")
              form.resetField("transfer_max_storage_gb")
              form.resetField("transfer_max_concurrency")
            }} onSave={handleSave} />}
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
                description="后台下载产物和一次性后台上传暂存文件的默认保留时间。"
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
                description="服务端同时执行的后台传输数量，保存后重启生效。"
                type="number"
                min={1}
                max={16}
                step={1}
                required
              />
            </div>

            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <h5 className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    关于定时上传暂存文件
                  </h5>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    定时任务使用的 SFTP 上传暂存文件会随任务删除或替换时自动清理，不受保留天数限制。
                  </p>
                </div>
              </div>
            </div>
          </SettingsSection>

          <Separator />

          <SettingsSection
            title="SSH / SFTP 连接池"
            description="控制复用连接的回收、健康检查和单连接并发，修改后重启服务生效。"
            icon={<Network className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
            actions={<SettingsFormActions visible={connectionPoolDirty} isSaving={isSaving} onReset={() => {
              form.resetField("sftp_max_idle_time_seconds")
              form.resetField("sftp_cleanup_interval_seconds")
              form.resetField("sftp_max_life_time_minutes")
              form.resetField("sftp_conn_timeout_seconds")
              form.resetField("sftp_max_sessions_per_conn")
            }} onSave={handleSave} />}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <FormInput form={form} name="sftp_max_idle_time_seconds" label="空闲回收时间" description="单位秒，连接持续空闲后自动关闭。" type="number" min={5} max={3600} />
              <FormInput form={form} name="sftp_cleanup_interval_seconds" label="连接扫描间隔" description="单位秒，执行清理与 keepalive 检查的频率。" type="number" min={5} max={600} />
              <FormInput form={form} name="sftp_max_life_time_minutes" label="连接最长寿命" description="单位分钟，0 表示不按总寿命回收。" type="number" min={0} max={1440} />
              <FormInput form={form} name="sftp_conn_timeout_seconds" label="连接超时" description="单位秒，用于建连与 keepalive。" type="number" min={1} max={120} />
              <FormInput form={form} name="sftp_max_sessions_per_conn" label="单连接 SFTP 会话上限" description="0 表示不限制，建议保持默认值 8。" type="number" min={0} max={64} />
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              这些参数在连接池创建时读取；保存后需重启 EasySSH，已有连接不会被强制中断。
            </div>
          </SettingsSection>

          <Separator />

          {/* 清理策略 */}
          <SettingsSection
            title="清理策略"
            description="定期清理过期的后台传输产物，释放 EasySSH 服务端存储空间。"
            icon={<Archive className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
            actions={<SettingsFormActions visible={cleanupDirty} isSaving={isSaving} onReset={() => form.resetField("transfer_cleanup_enabled")} onSave={handleSave} />}
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

    </div>
  )
}
