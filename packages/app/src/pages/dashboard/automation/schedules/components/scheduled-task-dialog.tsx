import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Upload, Download, Server, Clock, Settings2, FileText } from "lucide-react"
import type { ScheduledTaskType, Server as ApiServer, Script } from "@/lib/api"
import { ServerTagSelector } from "./server-tag-selector"

type ScheduledTaskDialogTask = {
  task_name: string
  description: string
  task_type: ScheduledTaskType
  command: string
  script_id: string | null
  cron_expression: string
  timezone: string
  enabled: boolean
  server_ids: string[]
  sftp_server_id: string
  sftp_source_path: string
  sftp_target_path: string
  sftp_retention_days: number
  sftp_upload_file: File | null
  sftp_staged_job_id: string
}

type ScheduledTaskDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  task: ScheduledTaskDialogTask
  onTaskChange: (task: ScheduledTaskDialogTask) => void
  servers: ApiServer[]
  scripts: Script[]
  onSubmit: () => void
  onOpenScriptLibrary: () => void
  t: (key: string) => string
}

const CRON_PRESETS = [
  { labelKey: "cronPresetEvery30m", value: "*/30 * * * *" },
  { labelKey: "cronPresetHourly", value: "0 * * * *" },
  { labelKey: "cronPresetDaily2am", value: "0 2 * * *" },
  { labelKey: "cronPresetWeeklyMon", value: "0 3 * * 1" },
] as const

const BASE_TIMEZONES = [
  { value: "Asia/Shanghai", labelKey: "timezoneAsiaShanghai" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong (UTC+8)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
  { value: "UTC", labelKey: "timezoneUTC" },
  { value: "America/New_York", labelKey: "timezoneAmericaNewYork" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-8)" },
  { value: "Europe/London", labelKey: "timezoneEuropeLondon" },
  { value: "Europe/Paris", label: "Europe/Paris (UTC+1)" },
] as const

export function ScheduledTaskDialog({
  open,
  onOpenChange,
  mode,
  task,
  onTaskChange,
  servers,
  scripts,
  onSubmit,
  onOpenScriptLibrary,
  t,
}: ScheduledTaskDialogProps) {
  const [currentTab, setCurrentTab] = useState("basic")

  useEffect(() => {
    if (open) {
      setCurrentTab("basic")
    }
  }, [open])

  const isSftpTask = task.task_type === "sftp_upload" || task.task_type === "sftp_download"
  const selectedScript = task.script_id ? scripts.find((s) => s.id === task.script_id) ?? null : null
  const hasCustomTimezone = Boolean(task.timezone && !BASE_TIMEZONES.some((tz) => tz.value === task.timezone))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {mode === "create" ? t("dialogCreateTitle") : t("dialogEditTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("dialogCreateDescription") : t("dialogEditDescription")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full grid-cols-3 shrink-0">
            <TabsTrigger value="basic" className="gap-2">
              <Settings2 className="h-4 w-4" />
              {t("dialogTabBasic")}
            </TabsTrigger>
            <TabsTrigger value="config" className="gap-2">
              <Server className="h-4 w-4" />
              {t("dialogTabConfig")}
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-2">
              <Clock className="h-4 w-4" />
              {t("dialogTabSchedule")}
            </TabsTrigger>
          </TabsList>

          {/* 步骤 1: 基本信息 */}
          <TabsContent value="basic" className="flex-1 min-h-0 overflow-y-auto scrollbar-custom mt-4 space-y-4 px-1">
            <div className="space-y-2">
              <Label htmlFor="task-name">
                {t("fieldTaskName")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="task-name"
                placeholder={t("fieldTaskNamePlaceholder")}
                value={task.task_name}
                onChange={(e) => onTaskChange({ ...task, task_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-description">{t("fieldTaskDescription")}</Label>
              <Input
                id="task-description"
                placeholder={t("fieldTaskDescriptionPlaceholder")}
                value={task.description}
                onChange={(e) => onTaskChange({ ...task, description: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-type">
                {t("fieldTaskType")} <span className="text-destructive">*</span>
              </Label>
              {mode === "edit" ? (
                <div className="p-3 rounded-md border bg-muted/30">
                  <Badge variant="outline">{getTaskTypeLabel(task.task_type, t)}</Badge>
                  <p className="text-xs text-muted-foreground mt-2">{t("dialogTaskTypeReadonly")}</p>
                </div>
              ) : (
                <Select
                  value={task.task_type}
                  onValueChange={(value) =>
                    onTaskChange({
                      ...task,
                      task_type: value as ScheduledTaskType,
                      server_ids: (value === "sftp_upload" || value === "sftp_download") ? [] : task.server_ids,
                      command: (value === "sftp_upload" || value === "sftp_download") ? "" : task.command,
                      script_id: value === "script" ? task.script_id : null,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="command">{t("typeCommand")}</SelectItem>
                    <SelectItem value="script">{t("typeScript")}</SelectItem>
                    <SelectItem value="sftp_upload">{t("typeSftpUpload")}</SelectItem>
                    <SelectItem value="sftp_download">{t("typeSftpDownload")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </TabsContent>

          {/* 步骤 2: 任务配置 */}
          <TabsContent value="config" className="flex-1 min-h-0 overflow-y-auto scrollbar-custom mt-4 space-y-4 px-1">
            {/* 命令任务 */}
            {task.task_type === "command" && (
              <div className="space-y-2">
                <Label htmlFor="task-command">
                  {t("fieldCommandLabel")} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="task-command"
                  placeholder={t("fieldCommandPlaceholder")}
                  className="font-mono min-h-[200px]"
                  value={task.command}
                  onChange={(e) => onTaskChange({ ...task, command: e.target.value })}
                />
              </div>
            )}

            {/* 脚本任务（后端强制绑定脚本库 script_id） */}
            {task.task_type === "script" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>
                    {t("scriptSelectedLabel")} <span className="text-destructive">*</span>
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenScriptLibrary}
                  >
                    {task.script_id ? t("scriptChangeButton") : t("scriptLibraryButton")}
                  </Button>
                </div>

                {selectedScript ? (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="size-4 text-muted-foreground" />
                      <span>{selectedScript.name}</span>
                    </div>
                    {selectedScript.description ? (
                      <p className="text-xs text-muted-foreground">{selectedScript.description}</p>
                    ) : null}
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2.5 font-mono text-xs">
                      {selectedScript.content}
                    </pre>
                  </div>
                ) : task.script_id ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    ID: <code className="font-mono">{task.script_id}</code>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                    <FileText className="size-6 opacity-50" />
                    <p>{t("scriptChoosePlaceholder")}</p>
                    <Button type="button" variant="outline" size="sm" onClick={onOpenScriptLibrary}>
                      {t("scriptLibraryButton")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* SFTP 上传任务 */}
            {task.task_type === "sftp_upload" && (
              <div className="rounded-lg border bg-gradient-to-br from-emerald-50/50 to-background p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <Upload className="h-5 w-5" />
                  <span>{t("sftpUploadConfigTitle")}</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sftp-server">
                      {t("sftpTargetServer")} <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={task.sftp_server_id}
                      onValueChange={(value) => onTaskChange({ ...task, sftp_server_id: value })}
                    >
                      <SelectTrigger id="sftp-server">
                        <SelectValue placeholder={t("sftpSelectServer")} />
                      </SelectTrigger>
                      <SelectContent>
                        {servers.map((server) => (
                          <SelectItem key={server.id} value={server.id}>
                            {server.name || server.host}
                            {server.status !== "online" ? ` (${t("serverStatusOffline")})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sftp-target-path">
                      {t("sftpTargetPath")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="sftp-target-path"
                      placeholder="/tmp"
                      value={task.sftp_target_path}
                      onChange={(e) => onTaskChange({ ...task, sftp_target_path: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sftp-upload-file">
                      {mode === "edit" ? t("sftpReplaceFile") : t("sftpStagedFile")} {mode === "create" && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      id="sftp-upload-file"
                      type="file"
                      onChange={(e) => onTaskChange({
                        ...task,
                        sftp_upload_file: e.target.files?.[0] ?? null,
                      })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {mode === "edit"
                        ? t("sftpReplaceFileHint")
                        : t("sftpStagedFileHint")}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sftp-retention">{t("sftpRetentionDays")}</Label>
                    <Input
                      id="sftp-retention"
                      type="number"
                      min={1}
                      max={30}
                      value={task.sftp_retention_days}
                      onChange={(e) => onTaskChange({
                        ...task,
                        sftp_retention_days: Number.parseInt(e.target.value, 10) || 3,
                      })}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SFTP 下载任务 */}
            {task.task_type === "sftp_download" && (
              <div className="rounded-lg border bg-gradient-to-br from-cyan-50/50 to-background p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-cyan-700 dark:text-cyan-400">
                  <Download className="h-5 w-5" />
                  <span>{t("sftpDownloadConfigTitle")}</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sftp-server-download">
                      {t("sftpSourceServer")} <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={task.sftp_server_id}
                      onValueChange={(value) => onTaskChange({ ...task, sftp_server_id: value })}
                    >
                      <SelectTrigger id="sftp-server-download">
                        <SelectValue placeholder={t("sftpSelectServer")} />
                      </SelectTrigger>
                      <SelectContent>
                        {servers.map((server) => (
                          <SelectItem key={server.id} value={server.id}>
                            {server.name || server.host}
                            {server.status !== "online" ? ` (${t("serverStatusOffline")})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sftp-retention-download">{t("sftpRetentionDays")}</Label>
                    <Input
                      id="sftp-retention-download"
                      type="number"
                      min={1}
                      max={30}
                      value={task.sftp_retention_days}
                      onChange={(e) => onTaskChange({
                        ...task,
                        sftp_retention_days: Number.parseInt(e.target.value, 10) || 3,
                      })}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="sftp-source-path">
                      {t("sftpSourcePath")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="sftp-source-path"
                      placeholder="/var/log/app.log"
                      value={task.sftp_source_path}
                      onChange={(e) => onTaskChange({ ...task, sftp_source_path: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sftpDownloadHint")}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* 步骤 3: 调度设置 */}
          <TabsContent value="schedule" className="flex-1 min-h-0 overflow-y-auto scrollbar-custom mt-4 space-y-4 px-1">
            {/* 服务器选择 (仅非 SFTP 任务显示) */}
            {!isSftpTask && (
              <ServerTagSelector
                servers={servers}
                selectedIds={task.server_ids}
                onSelectedChange={(ids) => onTaskChange({ ...task, server_ids: ids })}
                label={t("fieldTargetServers")}
                required
                t={t}
              />
            )}

            {/* Cron 表达式 */}
            <div className="space-y-2">
              <Label htmlFor="cron-expression">
                {t("fieldCronExpression")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cron-expression"
                placeholder={t("fieldCronPlaceholder")}
                value={task.cron_expression}
                onChange={(e) => onTaskChange({ ...task, cron_expression: e.target.value })}
                className="font-mono"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t("cronPresetsLabel")}:</span>
                {CRON_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={task.cron_expression === preset.value ? "secondary" : "outline"}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onTaskChange({ ...task, cron_expression: preset.value })}
                  >
                    {t(preset.labelKey)}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("fieldCronHelp")}
              </p>
            </div>

            {/* 时区 */}
            <div className="space-y-2">
              <Label htmlFor="timezone">{t("fieldTimezone")}</Label>
              <Select
                value={task.timezone}
                onValueChange={(value) => onTaskChange({ ...task, timezone: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BASE_TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {"labelKey" in tz ? t(tz.labelKey) : tz.label}
                    </SelectItem>
                  ))}
                  {hasCustomTimezone ? (
                    <SelectItem value={task.timezone}>{task.timezone}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>

            {/* 启用状态 */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="task-enabled"
                checked={task.enabled}
                onCheckedChange={(checked) => onTaskChange({ ...task, enabled: checked === true })}
              />
              <Label htmlFor="task-enabled" className="cursor-pointer">
                {mode === "create" ? t("fieldEnableOnCreate") : t("fieldEnableTask")}
              </Label>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("dialogCancel")}
          </Button>
          <Button onClick={onSubmit}>
            {mode === "create" ? t("dialogCreateSubmit") : t("dialogEditSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function getTaskTypeLabel(type: ScheduledTaskType, t: (key: string) => string) {
  if (type === "command") return t("typeCommand")
  if (type === "script") return t("typeScript")
  if (type === "sftp_upload") return t("typeSftpUpload")
  if (type === "sftp_download") return t("typeSftpDownload")
  return type
}
