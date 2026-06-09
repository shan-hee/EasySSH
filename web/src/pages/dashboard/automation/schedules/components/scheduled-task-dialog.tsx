import { useState } from "react"
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
import { Search, Upload, Download, Server, Clock, Settings2 } from "lucide-react"
import type { ScheduledTaskType, Server as ApiServer, Script } from "@/lib/api"

type ScheduledTaskDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  task: {
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
    sftp_staged_job_id?: string
  }
  onTaskChange: (task: any) => void
  servers: ApiServer[]
  scripts: Script[]
  onSubmit: () => void
  onOpenScriptLibrary: () => void
  t: (key: string) => string
}

export function ScheduledTaskDialog({
  open,
  onOpenChange,
  mode,
  task,
  onTaskChange,
  servers,
  onSubmit,
  onOpenScriptLibrary,
  t,
}: ScheduledTaskDialogProps) {
  const [serverSearchTerm, setServerSearchTerm] = useState("")
  const [currentTab, setCurrentTab] = useState("basic")

  const isSftpTask = task.task_type === "sftp_upload" || task.task_type === "sftp_download"
  const filteredServers = servers.filter(
    (server) =>
      (server.name?.toLowerCase().includes(serverSearchTerm.toLowerCase()) ?? false) ||
      server.host.toLowerCase().includes(serverSearchTerm.toLowerCase())
  )

  const toggleServer = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId)
    if (server && server.status !== "online") {
      return
    }

    onTaskChange({
      ...task,
      server_ids: task.server_ids.includes(serverId)
        ? task.server_ids.filter((id) => id !== serverId)
        : [...task.server_ids, serverId],
    })
  }

  const toggleSelectAll = () => {
    const onlineServers = filteredServers.filter((s) => s.status === "online")
    if (task.server_ids.length === onlineServers.length) {
      onTaskChange({ ...task, server_ids: [] })
    } else {
      onTaskChange({ ...task, server_ids: onlineServers.map((s) => s.id) })
    }
  }

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
          <TabsContent value="basic" className="flex-1 min-h-0 overflow-y-auto scrollbar-custom mt-4 space-y-4">
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
                    <SelectItem value="batch">{t("typeBatch")}</SelectItem>
                    <SelectItem value="sftp_upload">{t("typeSftpUpload")}</SelectItem>
                    <SelectItem value="sftp_download">{t("typeSftpDownload")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </TabsContent>

          {/* 步骤 2: 任务配置 */}
          <TabsContent value="config" className="flex-1 min-h-0 overflow-y-auto scrollbar-custom mt-4 space-y-4">
            {/* 命令/脚本任务 */}
            {(task.task_type === "command" || task.task_type === "script") && (
              <div className="space-y-2">
                <Label htmlFor="task-command">
                  {task.task_type === "command" ? t("fieldCommandLabel") : t("fieldScriptLabel")}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-2">
                  <Textarea
                    id="task-command"
                    placeholder={
                      task.task_type === "command"
                        ? t("fieldCommandPlaceholder")
                        : t("fieldScriptPlaceholder")
                    }
                    className="font-mono min-h-[200px]"
                    value={task.command}
                    onChange={(e) => onTaskChange({ ...task, command: e.target.value })}
                  />
                  {task.task_type === "script" && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onOpenScriptLibrary}
                    >
                      {t("scriptLibraryButton")}
                    </Button>
                  )}
                </div>
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
                        {servers
                          .filter((server) => server.status === "online")
                          .map((server) => (
                            <SelectItem key={server.id} value={server.id}>
                              {server.name || server.host}
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
                        : t("sftpStagedFileHint")
                      }
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
                        {servers
                          .filter((server) => server.status === "online")
                          .map((server) => (
                            <SelectItem key={server.id} value={server.id}>
                              {server.name || server.host}
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
          <TabsContent value="schedule" className="flex-1 min-h-0 overflow-y-auto scrollbar-custom mt-4 space-y-4">
            {/* 服务器选择 (仅非 SFTP 任务显示) */}
            {!isSftpTask && (
              <div className="space-y-2">
                <Label>
                  {t("fieldTargetServers")} <span className="text-destructive">*</span>
                </Label>
                <div className="max-h-[240px] overflow-y-auto rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {t("selectedServersCount")}: {task.server_ids.length}
                    </span>
                    <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
                      {task.server_ids.length === filteredServers.filter((s) => s.status === "online").length
                        ? t("unselectAll")
                        : t("selectAll")}
                    </Button>
                  </div>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder={t("serverSearchPlaceholder")}
                      className="pl-10"
                      value={serverSearchTerm}
                      onChange={(e) => setServerSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    {filteredServers
                      .filter((s) => s.status === "online")
                      .map((server) => (
                        <div
                          key={server.id}
                          className={`flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-accent ${
                            task.server_ids.includes(server.id) ? "bg-accent" : ""
                          }`}
                          onClick={() => toggleServer(server.id)}
                        >
                          <input
                            type="checkbox"
                            checked={task.server_ids.includes(server.id)}
                            onChange={() => toggleServer(server.id)}
                            className="cursor-pointer"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium">{server.name || server.host}</div>
                            <div className="text-xs text-muted-foreground">{server.host}</div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {server.status}
                          </Badge>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
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
                  <SelectItem value="Asia/Shanghai">{t("timezoneAsiaShanghai")}</SelectItem>
                  <SelectItem value="UTC">{t("timezoneUTC")}</SelectItem>
                  <SelectItem value="America/New_York">{t("timezoneAmericaNewYork")}</SelectItem>
                  <SelectItem value="Europe/London">{t("timezoneEuropeLondon")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 启用状态 */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="task-enabled"
                checked={task.enabled}
                onChange={(e) => onTaskChange({ ...task, enabled: e.target.checked })}
                className="cursor-pointer"
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
  if (type === "batch") return t("typeBatch")
  if (type === "sftp_upload") return t("typeSftpUpload")
  if (type === "sftp_download") return t("typeSftpDownload")
  return type
}
