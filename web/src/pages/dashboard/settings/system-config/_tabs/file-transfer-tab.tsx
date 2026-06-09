import { SettingsSection } from "@/components/settings/settings-section"
import { FormTextarea, FormSwitch, FormInput } from "@/components/settings/form-field"
import { Archive, Download, HardDrive, Loader2, RotateCcw, Save, ChevronDown, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { fileTransferSchema } from "@/schemas/settings/system-config.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { useTranslation } from "react-i18next"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { useState } from "react"

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

  const [isExcludePatternsOpen, setIsExcludePatternsOpen] = useState(false)

  if (isLoading) {
    return <SettingsLoading />
  }

  // 计算排除规则数量
  const excludePatterns = form.watch("download_exclude_patterns") || ""
  const patternCount = excludePatterns.split("\n").filter(p => p.trim()).length

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-4">
        <div className="space-y-6">
          {/* 会话传输 */}
          <SettingsSection
            title="会话传输"
            description="终端或 SFTP 面板内的上传下载跟随当前连接生命周期。"
            icon={<Download className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
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

          {/* 清理策略 */}
          <SettingsSection
            title="清理策略"
            description="定期清理过期的后台传输产物，释放 EasySSH 服务端存储空间。"
            icon={<Archive className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
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

      {/* 底部操作栏 */}
      <div className="shrink-0 flex items-center justify-between gap-2 p-4 border-t bg-background">
        <p className="text-sm text-muted-foreground">
          修改后点击保存按钮应用更改
        </p>
        <div className="flex gap-2">
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
    </div>
  )
}
