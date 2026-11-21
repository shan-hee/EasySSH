
import { useState, useEffect, useMemo, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { PageHeader } from "@/components/page-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { getErrorMessage } from "@/lib/error-utils"
import { cn } from "@/lib/utils"
import { isApiError } from "@/lib/api-client"
import {
	 Dialog,
	 DialogContent,
	 DialogDescription,
	 DialogHeader,
	 DialogTitle,
} from "@/components/ui/dialog"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import { MAX_TABLE_PAGE_SIZE } from "@/lib/table-pagination"
import {
 Plus,
 Search,
 FileText,
 Clock,
 Terminal,
 Upload,
 Download,
 Calendar,
 Activity,
 AlertTriangle,
 CheckCircle2,
 History,
 Zap,
} from "lucide-react"
import {
 scheduledTasksApi,
 scriptsApi,
 serversApi,
 transferJobsApi,
 type ScheduledTask,
 type ScheduledTaskType,
 type Script,
 type Server
} from "@/lib/api"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useClientAuth } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/hooks/use-system-config"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { formatInTimezone, getEffectiveLocale, getEffectiveTimezone } from "@/utils/datetime"
import { loadAllServers } from "@/lib/server-utils"
import { openWorkspaceTask } from "@/lib/workspace-task-navigation"
import { useTranslation } from "react-i18next"
import { createScheduledTaskColumns } from "./automation/schedules/components/scheduled-task-columns"
import { ScheduledTaskDialog } from "./automation/schedules/components/scheduled-task-dialog"
import { queryKeys } from "@/lib/query-keys"

type ScheduledPayload = {
 server_id?: string
 source_path?: string
 target_path?: string
 staged_job_id?: string
 name?: string
 description?: string
 retention_days?: number
}

const parseScheduledPayload = (value?: string): ScheduledPayload => {
 if (!value) return {}
 try {
 return JSON.parse(value) as ScheduledPayload
 } catch {
 return {}
 }
}

const getTaskTypeTone = (type: ScheduledTaskType) => {
 if (type === "command") return "blue" as const
 if (type === "script") return "violet" as const
 if (type === "sftp_upload") return "emerald" as const
 if (type === "sftp_download") return "cyan" as const
 return "slate" as const
}

const isSftpTaskType = (type: ScheduledTaskType) => (
 type === "sftp_upload" || type === "sftp_download"
)

// 时间线节点的色调样式：圆点、光晕、柔和底色、文字色
const TONE_NODE: Record<string, { dot: string; glow: string; soft: string; text: string }> = {
 blue: {
 dot: "bg-blue-500",
 glow: "shadow-[0_0_0_5px_rgba(59,130,246,0.18)]",
 soft: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
 text: "text-blue-600 dark:text-blue-400",
 },
 violet: {
 dot: "bg-violet-500",
 glow: "shadow-[0_0_0_5px_rgba(139,92,246,0.18)]",
 soft: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
 text: "text-violet-600 dark:text-violet-400",
 },
 amber: {
 dot: "bg-amber-500",
 glow: "shadow-[0_0_0_5px_rgba(245,158,11,0.18)]",
 soft: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
 text: "text-amber-600 dark:text-amber-400",
 },
 emerald: {
 dot: "bg-emerald-500",
 glow: "shadow-[0_0_0_5px_rgba(16,185,129,0.18)]",
 soft: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
 text: "text-emerald-600 dark:text-emerald-400",
 },
 cyan: {
 dot: "bg-cyan-500",
 glow: "shadow-[0_0_0_5px_rgba(6,182,212,0.18)]",
 soft: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
 text: "text-cyan-600 dark:text-cyan-400",
 },
 slate: {
 dot: "bg-slate-400",
 glow: "shadow-[0_0_0_5px_rgba(100,116,139,0.16)]",
 soft: "bg-muted text-muted-foreground",
 text: "text-muted-foreground",
 },
}

const getToneNode = (tone: string) => TONE_NODE[tone] || TONE_NODE.slate

// 时间线卡片上的类型图标
const getTaskTypeIcon = (type: ScheduledTaskType) => {
 switch (type) {
 case "command":
 return <Terminal className="h-3 w-3" />
 case "script":
 return <FileText className="h-3 w-3" />
 case "sftp_upload":
 return <Upload className="h-3 w-3" />
 case "sftp_download":
 return <Download className="h-3 w-3" />
 default:
 return <Calendar className="h-3 w-3" />
 }
}

// 把"下次执行时间"转成相对表述，体现时间线的临近感
const formatRelativeTime = (
 nextRunAt: string | undefined,
 nowMs: number,
 t: (key: string, values?: Record<string, string | number>) => string,
 locale: string,
): string => {
 if (!nextRunAt) return "—"
 const target = new Date(nextRunAt).getTime()
 if (Number.isNaN(target)) return "—"
 const diffMs = target - nowMs
 if (diffMs <= 0) return t("relativeDue")
 const mins = Math.round(diffMs / 60000)
 if (mins < 1) return t("relativeSoon")
 if (mins < 60) return t("relativeMinutes", { count: mins })
 const hours = Math.round(mins / 60)
 if (hours < 24) return t("relativeHours", { count: hours })
 const days = Math.round(hours / 24)
 if (days === 1) return t("relativeTomorrow")
 if (days < 7) return t("relativeDays", { count: days })
 return new Date(nextRunAt).toLocaleDateString(locale, { month: "short", day: "numeric" })
}

export default function AutomationSchedulesPage({
 embedded = false,
 onViewRuns,
}: {
 embedded?: boolean
 onViewRuns?: (task: ScheduledTask) => void
}) {
 const { ready } = useAuthReady()
 const { user } = useClientAuth()
 const { data: systemConfig } = useSystemConfig()
 const effectiveLocale = getEffectiveLocale(user, systemConfig || null)
 const effectiveTimezone = getEffectiveTimezone(user, systemConfig || null)
 const { t } = useTranslation("automationSchedules")
 const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
 const [nowMs, setNowMs] = useState(() => Date.now())
 useEffect(() => {
   const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
   return () => window.clearInterval(timer)
 }, [])
 // 对话框状态
 const [isDialogOpen, setIsDialogOpen] = useState(false)
 const [dialogMode, setDialogMode] = useState<"create" | "edit">("create")
 const [isScriptLibraryOpen, setIsScriptLibraryOpen] = useState(false)
 const [editingTaskId, setEditingTaskId] = useState<string | null>(null)

 // 统一的任务表单状态
 const [taskForm, setTaskForm] = useState({
 task_name: "",
 description: "",
 task_type: "command" as ScheduledTaskType,
 command: "",
 script_id: null as string | null,
 cron_expression: "",
 timezone: effectiveTimezone || "Asia/Shanghai",
 enabled: true,
 server_ids: [] as string[],
 sftp_server_id: "",
 sftp_source_path: "",
 sftp_target_path: "/",
 sftp_retention_days: 3,
 sftp_upload_file: null as File | null,
 sftp_staged_job_id: "",
 })

	 // 脚本库筛选状态
	 const [scriptSearchTerm, setScriptSearchTerm] = useState("")

 const administrationQuery = useQuery({
   queryKey: queryKeys.scheduledTasks.administration,
   queryFn: async () => {
     const [tasksRes, allServers, scriptsRes] = await Promise.all([
       scheduledTasksApi.list({ page: 1, limit: MAX_TABLE_PAGE_SIZE }),
       loadAllServers((params) => serversApi.list(params)),
       scriptsApi.list({ page: 1, limit: MAX_TABLE_PAGE_SIZE }),
     ])
     return {
       tasks: Array.isArray(tasksRes?.data) ? tasksRes.data : [],
       servers: allServers,
       scripts: Array.isArray(scriptsRes?.data) ? scriptsRes.data : [],
     }
   },
   enabled: ready,
 })
 const tasks: ScheduledTask[] = useMemo(
   () => administrationQuery.data?.tasks ?? [],
   [administrationQuery.data?.tasks],
 )
 const servers: Server[] = useMemo(
   () => administrationQuery.data?.servers ?? [],
   [administrationQuery.data?.servers],
 )
 const scripts: Script[] = useMemo(
   () => administrationQuery.data?.scripts ?? [],
   [administrationQuery.data?.scripts],
 )
 const loading = administrationQuery.isPending
 const refreshing = administrationQuery.isFetching && !administrationQuery.isPending
 const loadData = async () => {
   await administrationQuery.refetch()
 }

 // 刷新数据
 const handleRefresh = async () => {
   await loadData()
 }

 useEffect(() => {
   if (administrationQuery.error) {
     toast.error(getErrorMessage(administrationQuery.error, t("toastLoadFailed")))
   }
 }, [administrationQuery.error, t])


	 // 过滤脚本
 const filteredScripts = scripts.filter(
 (script) =>
 script.name.toLowerCase().includes(scriptSearchTerm.toLowerCase()) ||
 (script.description &&
 script.description.toLowerCase().includes(scriptSearchTerm.toLowerCase()))
 )

 const cleanupStagedJob = async (stagedJobId: string) => {
 if (!stagedJobId) return true
 try {
 await transferJobsApi.delete(stagedJobId)
 return true
 } catch (error: unknown) {
 if (isApiError(error) && error.status === 404) {
 return true
 }
 console.warn("清理 SFTP 暂存文件失败:", error)
 return false
 }
 }

 // 打开新建对话框
 const handleOpenCreateDialog = useCallback(() => {
 setEditingTaskId(null)
 setTaskForm({
 task_name: "",
 description: "",
 task_type: "command",
 command: "",
 script_id: null,
 cron_expression: "",
 timezone: effectiveTimezone || "Asia/Shanghai",
 enabled: true,
 server_ids: [],
 sftp_server_id: "",
 sftp_source_path: "",
 sftp_target_path: "/",
 sftp_retention_days: 3,
 sftp_upload_file: null,
 sftp_staged_job_id: "",
 })
 setDialogMode("create")
 setIsDialogOpen(true)
 }, [effectiveTimezone])

 // 服务器选择处理 - 已移到对话框组件内部

 // 从脚本库选择脚本
 const handleSelectScript = (script: Script) => {
 setTaskForm({
 ...taskForm,
 command: script.content,
 script_id: script.id,
 task_type: "script",
 })
 setIsScriptLibraryOpen(false)
 setScriptSearchTerm("")
 }

 // 创建定时任务
 const handleCreateTask = async () => {
 const isSftpUpload = taskForm.task_type === "sftp_upload"
 const isSftpDownload = taskForm.task_type === "sftp_download"
 const isSftpTask = isSftpTaskType(taskForm.task_type)

 if (!taskForm.task_name || !taskForm.cron_expression) {
 toast.error(t("toastMustNameCron"))
 return
 }

 if (taskForm.task_type === "command" && !taskForm.command) {
 toast.error(t("toastCmdRequired"))
 return
 }

 if (taskForm.task_type === "script" && !taskForm.script_id) {
 toast.error(t("toastScriptRequired"))
 return
 }

 if (!isSftpTask && taskForm.server_ids.length === 0) {
 toast.error(t("toastSelectServer"))
 return
 }

 if (isSftpUpload && (!taskForm.sftp_server_id || !taskForm.sftp_target_path || !taskForm.sftp_upload_file)) {
 toast.error(t("toastSftpUploadRequired"))
 return
 }

 if (isSftpDownload && (!taskForm.sftp_server_id || !taskForm.sftp_source_path)) {
 toast.error(t("toastSftpDownloadRequired"))
 return
 }

 let stagedJobIdToCleanup = ""
 try {
 let payloadJSON: string | undefined
 let serverIds = taskForm.server_ids

 if (isSftpUpload && taskForm.sftp_upload_file) {
 const stagedJob = await transferJobsApi.createBackgroundUpload({
 serverId: taskForm.sftp_server_id,
 targetPath: taskForm.sftp_target_path,
 file: taskForm.sftp_upload_file,
 name: `${taskForm.task_name} - 暂存文件`,
 description: taskForm.description || undefined,
 retentionDays: taskForm.sftp_retention_days,
 deferStart: true,
 })
 stagedJobIdToCleanup = stagedJob.id
 payloadJSON = JSON.stringify({
 staged_job_id: stagedJob.id,
 server_id: taskForm.sftp_server_id,
 target_path: taskForm.sftp_target_path,
 retention_days: taskForm.sftp_retention_days,
 name: taskForm.task_name,
 description: taskForm.description || undefined,
 })
 serverIds = [taskForm.sftp_server_id]
 }

 if (isSftpDownload) {
 payloadJSON = JSON.stringify({
 server_id: taskForm.sftp_server_id,
 source_path: taskForm.sftp_source_path,
 retention_days: taskForm.sftp_retention_days,
 name: taskForm.task_name,
 description: taskForm.description || undefined,
 })
 serverIds = [taskForm.sftp_server_id]
 }

 await scheduledTasksApi.create({
 task_name: taskForm.task_name,
 task_type: taskForm.task_type,
 command: isSftpTask ? undefined : taskForm.command || undefined,
 script_id: taskForm.task_type === "script" ? taskForm.script_id || undefined : undefined,
 payload_json: payloadJSON,
 server_ids: serverIds,
 cron_expression: taskForm.cron_expression,
 timezone: taskForm.timezone,
 enabled: taskForm.enabled,
 description: taskForm.description || undefined,
 })
 stagedJobIdToCleanup = ""

 toast.success(t("toastCreateSuccess"))
 setIsDialogOpen(false)

 // 重新加载任务列表
 await loadData()
 } catch (error: unknown) {
 if (typeof stagedJobIdToCleanup === "string" && stagedJobIdToCleanup) {
 await cleanupStagedJob(stagedJobIdToCleanup)
 }
 console.error("创建定时任务失败:", error)
 toast.error(getErrorMessage(error, t("toastCreateFailed")))
 }
 }

 // 编辑任务
 const handleEdit = (task: ScheduledTask) => {
 const payload = parseScheduledPayload(task.payload_json)
 const linkedScript = task.script_id ? scripts.find((s) => s.id === task.script_id) : undefined
 setEditingTaskId(task.id)
 setTaskForm({
 task_name: task.task_name,
 description: task.description || "",
 task_type: task.task_type,
 command: task.command || linkedScript?.content || "",
 script_id: task.script_id ?? null,
 cron_expression: task.cron_expression,
 timezone: task.timezone,
 enabled: task.enabled,
 server_ids: task.server_ids || [],
 sftp_server_id: payload.server_id || task.server_ids?.[0] || "",
 sftp_source_path: payload.source_path || "",
 sftp_target_path: payload.target_path || "/",
 sftp_retention_days: payload.retention_days || 3,
 sftp_upload_file: null,
 sftp_staged_job_id: payload.staged_job_id || "",
 })
 setDialogMode("edit")
 setIsDialogOpen(true)
 }

 // 更新定时任务
 const handleUpdateTask = async () => {
 const isSftpUpload = taskForm.task_type === "sftp_upload"
 const isSftpDownload = taskForm.task_type === "sftp_download"
 const isSftpTask = isSftpTaskType(taskForm.task_type)

 if (!taskForm.task_name || !taskForm.cron_expression) {
 toast.error(t("toastMustNameCron"))
 return
 }

 if (editingTaskId === null) return

 if (taskForm.task_type === "command" && !taskForm.command) {
 toast.error(t("toastCmdRequired"))
 return
 }

 if (taskForm.task_type === "script" && !taskForm.script_id) {
 toast.error(t("toastScriptRequired"))
 return
 }

 if (!isSftpTask && taskForm.server_ids.length === 0) {
 toast.error(t("toastSelectServer"))
 return
 }

 if (isSftpUpload && (!taskForm.sftp_server_id || !taskForm.sftp_target_path || (!taskForm.sftp_staged_job_id && !taskForm.sftp_upload_file))) {
 toast.error(t("toastSftpUploadRequired"))
 return
 }

 if (isSftpDownload && (!taskForm.sftp_server_id || !taskForm.sftp_source_path)) {
 toast.error(t("toastSftpDownloadRequired"))
 return
 }

 let uploadedStagedJobIdToCleanup = ""
 try {
 let payloadJSON: string | undefined
 let serverIds = taskForm.server_ids

 if (isSftpUpload) {
 let stagedJobId = taskForm.sftp_staged_job_id
 if (taskForm.sftp_upload_file) {
 const stagedJob = await transferJobsApi.createBackgroundUpload({
 serverId: taskForm.sftp_server_id,
 targetPath: taskForm.sftp_target_path,
 file: taskForm.sftp_upload_file,
 name: `${taskForm.task_name} - 暂存文件`,
 description: taskForm.description || undefined,
 retentionDays: taskForm.sftp_retention_days,
 deferStart: true,
 })
 stagedJobId = stagedJob.id
 uploadedStagedJobIdToCleanup = stagedJob.id
 }
 payloadJSON = JSON.stringify({
 staged_job_id: stagedJobId,
 server_id: taskForm.sftp_server_id,
 target_path: taskForm.sftp_target_path,
 retention_days: taskForm.sftp_retention_days,
 name: taskForm.task_name,
 description: taskForm.description || undefined,
 })
 serverIds = [taskForm.sftp_server_id]
 }

 if (isSftpDownload) {
 payloadJSON = JSON.stringify({
 server_id: taskForm.sftp_server_id,
 source_path: taskForm.sftp_source_path,
 retention_days: taskForm.sftp_retention_days,
 name: taskForm.task_name,
 description: taskForm.description || undefined,
 })
 serverIds = [taskForm.sftp_server_id]
 }

 await scheduledTasksApi.update(editingTaskId, {
 task_name: taskForm.task_name,
 task_type: taskForm.task_type,
 command: taskForm.task_type === "command" ? taskForm.command || undefined : undefined,
 script_id: taskForm.task_type === "script" ? taskForm.script_id || undefined : undefined,
 payload_json: payloadJSON,
 server_ids: serverIds,
 cron_expression: taskForm.cron_expression,
 timezone: taskForm.timezone,
 enabled: taskForm.enabled,
 description: taskForm.description || undefined,
 })
 uploadedStagedJobIdToCleanup = ""

 toast.success(t("toastUpdateSuccess"))
 setIsDialogOpen(false)
 setEditingTaskId(null)

 // 重新加载任务列表
 await loadData()
 } catch (error: unknown) {
 if (typeof uploadedStagedJobIdToCleanup === "string" && uploadedStagedJobIdToCleanup) {
 await cleanupStagedJob(uploadedStagedJobIdToCleanup)
 }
 console.error("更新定时任务失败:", error)
 toast.error(getErrorMessage(error, t("toastUpdateFailed")))
 }
 }

 // 删除任务
 const handleDelete = async (taskId: string) => {
 const confirmed = await requestConfirm({
 description: t("toastDeleteConfirm"),
 variant: "destructive",
 })
 if (!confirmed) {
 return
 }

 try {
 // 认证基于 HttpOnly Cookie

 await scheduledTasksApi.delete(taskId)
 toast.success(t("toastDeleteSuccess"))
 await loadData()
 } catch (error: unknown) {
 console.error("删除定时任务失败:", error)
 toast.error(getErrorMessage(error, t("toastDeleteFailed")))
 }
 }

 // 启用/禁用任务
 const handleToggle = async (taskId: string, enabled: boolean) => {
 try {
 // 认证基于 HttpOnly Cookie

 await scheduledTasksApi.toggle(taskId, !enabled)
 toast.success(enabled ? t("toastToggleDisabled") : t("toastToggleEnabled"))
 await loadData()
 } catch (error: unknown) {
 console.error("切换任务状态失败:", error)
 toast.error(getErrorMessage(error, t("toastToggleFailed")))
 }
 }

 // 手动触发任务
 const handleTrigger = async (taskId: string) => {
 try {
 // 认证基于 HttpOnly Cookie

 const result = await scheduledTasksApi.trigger(taskId)
 if (result?.task_run_id) {
   toast.success(t("toastTriggerSuccess"), {
     action: {
       label: t("toastTriggerViewRun"),
       onClick: () => openWorkspaceTask(result.task_run_id),
     },
   })
 } else {
   toast.success(t("toastTriggerSuccess"))
 }
 await loadData()
 } catch (error: unknown) {
 console.error("触发任务失败:", error)
 toast.error(getErrorMessage(error, t("toastTriggerFailed")))
 }
 }

 // 格式化日期（按用户/系统时区）
 const formatDate = useCallback((dateString: string | undefined) => {
   if (!dateString) return "-"
   return formatInTimezone(
     dateString,
     { second: undefined },
     effectiveLocale,
     effectiveTimezone,
   )
 }, [effectiveLocale, effectiveTimezone])

 // 创建表格列配置
 const columns = createScheduledTaskColumns(t, {
 onToggle: handleToggle,
 onTrigger: handleTrigger,
 onEdit: handleEdit,
 onDelete: handleDelete,
 onViewRuns,
 formatDate,
 })

 const upcomingTasks = useMemo(() => (
   [...tasks]
     .filter((task) => task.enabled && task.next_run_at)
     .sort((a, b) => new Date(a.next_run_at || 0).getTime() - new Date(b.next_run_at || 0).getTime())
     .slice(0, 4)
 ), [tasks])

 const scheduleStats = useMemo(() => {
   let enabled = 0
   let attention = 0
   let totalRuns = 0
   let totalFailures = 0
   for (const task of tasks) {
     if (task.enabled) enabled += 1
     if (task.last_status === "failed" || task.last_status === "unknown") attention += 1
     totalRuns += task.run_count || 0
     totalFailures += task.failure_count || 0
   }
   const disabled = Math.max(0, tasks.length - enabled)
   const successRate = totalRuns > 0 ? Math.round(((Math.max(0, totalRuns - totalFailures)) / totalRuns) * 100) : null
   return {
     total: tasks.length,
     enabled,
     disabled,
     attention,
     totalRuns,
     successRate,
   }
 }, [tasks])

 return (
 <>
 {confirmDialog}
  {!embedded ? <PageHeader title={t("pageTitle")} /> : null}

 <DashboardPageContent className={cn("min-h-auto gap-3", embedded && "px-0 pb-0")}>
   {/* 与运行记录页统一的 4 张卡片化 KPI 概览 */}
   <div className="grid shrink-0 grid-cols-2 gap-2.5 lg:grid-cols-4">
     <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3">
       <div className="min-w-0">
         <div className="truncate text-xs text-muted-foreground">{t("statsTotalTasks")}</div>
         <div className="mt-1 text-2xl font-semibold leading-none tracking-tight tabular-nums">
           {scheduleStats.total.toLocaleString()}
         </div>
         <div className="mt-1.5 truncate text-[11px] text-muted-foreground">
           {t("statsActiveCountSub", { enabled: scheduleStats.enabled, disabled: scheduleStats.disabled })}
         </div>
       </div>
       <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
         <Calendar className="size-4" />
       </div>
     </div>

     <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3">
       <div className="min-w-0">
         <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
           <span className="truncate">{t("statsEnabled")}</span>
           {scheduleStats.enabled > 0 ? (
             <span className="relative flex size-2 shrink-0">
               <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
               <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
             </span>
           ) : null}
         </div>
         <div className="mt-1 text-2xl font-semibold leading-none tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
           {scheduleStats.enabled.toLocaleString()}
         </div>
         <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{t("statsEnabledDesc")}</div>
       </div>
       <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
         <CheckCircle2 className="size-4" />
       </div>
     </div>

     <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3">
       <div className="min-w-0">
         <div className="truncate text-xs text-muted-foreground">{t("statsAttention")}</div>
         <div className={cn("mt-1 text-2xl font-semibold leading-none tracking-tight tabular-nums", scheduleStats.attention > 0 && "text-destructive")}>
           {scheduleStats.attention.toLocaleString()}
         </div>
         <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{t("statsAttentionDesc")}</div>
       </div>
       <div className={cn(
         "flex size-9 shrink-0 items-center justify-center rounded-lg",
         scheduleStats.attention > 0 ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground",
       )}>
         <AlertTriangle className="size-4" />
       </div>
     </div>

     <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3">
       <div className="min-w-0">
         <div className="truncate text-xs text-muted-foreground">{t("statsTotalRuns")}</div>
         <div className="mt-1 text-2xl font-semibold leading-none tracking-tight tabular-nums">
           {scheduleStats.totalRuns.toLocaleString()}
         </div>
         <div className="mt-1.5 truncate text-[11px] text-muted-foreground">
           {scheduleStats.successRate !== null
             ? t("statsSuccessRateSub", { rate: scheduleStats.successRate })
             : t("statsTotalRunsDesc")}
         </div>
       </div>
       <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/12 text-sky-600 dark:text-sky-400">
         <Activity className="size-4" />
       </div>
     </div>
   </div>

   <Card className="shrink-0 gap-0 rounded-xl p-4 sm:p-5">
     <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
       <div className="min-w-0">
         <h2 className="text-sm font-semibold">{t("timelineHeading")}</h2>
         <p className="mt-0.5 text-xs text-muted-foreground">{t("timelineDescription")}</p>
       </div>
       <Button size="sm" className="shrink-0" onClick={handleOpenCreateDialog}>
         <Plus className="mr-1.5 size-4" />
         {t("newTask")}
       </Button>
     </div>
     {upcomingTasks.length === 0 ? (
       <div className="mt-4 flex items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-xs text-muted-foreground">
         <Calendar className="size-4 shrink-0 opacity-60" />
         <span>{t("emptyAll")}</span>
       </div>
     ) : (
       <div className="mt-4 overflow-x-auto pb-1">
         <div className="relative min-w-[740px]">
           {/* 时间轨道：从"现在"锚点向右延伸的渐变线 */}
           <div className="pointer-events-none absolute left-10 right-0 top-[34px] h-px bg-gradient-to-r from-emerald-500/60 via-border to-transparent" />
           <div className="flex items-start gap-3">
             {/* "现在"锚点 */}
             <div className="flex w-16 shrink-0 flex-col items-center">
               <span className="mb-2 h-5 rounded-full bg-emerald-500/10 px-2 text-[11px] font-medium leading-5 text-emerald-700 dark:text-emerald-300">
                 {t("timelineNow")}
               </span>
               <div className="relative size-3.5">
                 <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-60" />
                 <span className="absolute inset-0 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]" />
               </div>
             </div>
             {/* 任务节点：按临近顺序自适应平铺 */}
             <div className="grid flex-1 grid-cols-4 gap-3">
               {upcomingTasks.slice(0, 4).map((task, index) => {
                 const tone = getTaskTypeTone(task.task_type)
                 const node = getToneNode(tone)
                 const isNext = index === 0
                 return (
                   <div key={task.id} className="group flex min-w-0 flex-col items-center">
                     <span
                       className={cn(
                         "mb-2 h-5 rounded-full px-2 text-[11px] font-medium leading-5 tabular-nums",
                         isNext ? node.soft : "bg-muted/60 text-muted-foreground",
                       )}
                     >
                       {formatRelativeTime(task.next_run_at, nowMs, t, effectiveLocale)}
                     </span>
                     <div className={cn("relative size-3.5 rounded-full transition-transform group-hover:scale-110", node.dot, isNext && node.glow)} />
                     <div className="mt-3 w-full rounded-xl border bg-background/80 p-3 text-left transition-all hover:border-foreground/20 hover:bg-muted/20">
                       <div className="flex items-center justify-between gap-1.5">
                         <div className="flex min-w-0 items-center gap-1.5">
                           <span className={cn("shrink-0", node.text)}>{getTaskTypeIcon(task.task_type)}</span>
                           <span className="truncate text-xs font-medium" title={task.task_name}>{task.task_name}</span>
                         </div>
                         <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                           <Button
                             type="button"
                             variant="ghost"
                             size="icon-sm"
                             className="size-6 text-muted-foreground hover:text-foreground"
                             title={t("actionImmediateRun")}
                             aria-label={t("actionImmediateRun")}
                             onClick={() => void handleTrigger(task.id)}
                           >
                             <Zap className="size-3" />
                           </Button>
                           {onViewRuns ? (
                             <Button
                               type="button"
                               variant="ghost"
                               size="icon-sm"
                               className="size-6 text-muted-foreground hover:text-foreground"
                               title={t("actionViewRuns")}
                               aria-label={t("actionViewRuns")}
                               onClick={() => onViewRuns(task)}
                             >
                               <History className="size-3" />
                             </Button>
                           ) : null}
                         </div>
                       </div>
                       <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                         <Clock className="size-3 shrink-0" />
                         <span className="truncate tabular-nums">{formatDate(task.next_run_at)}</span>
                       </div>
                       <div className="mt-2 flex items-center justify-between gap-1.5">
                         <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{task.cron_expression}</code>
                         <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{t("timelineServerCount", { count: (task.server_ids || []).length })}</span>
                       </div>
                     </div>
                   </div>
                 )
               })}
             </div>
           </div>
         </div>
       </div>
     )}
   </Card>

   <DataTable
     data={tasks}
     columns={columns}
     loading={loading}
     emptyMessage={t("emptyAll")}
     getRowId={(task) => task.id}
     density="compact"
     toolbar={(table) => (
       <DataTableToolbar
         table={table}
         searchKey="task_name"
         searchPlaceholder={t("searchPlaceholder")}
         filters={[
           {
             column: "enabled",
             title: t("statusFilterPlaceholder"),
             options: [
               { label: t("statusFilterEnabled"), value: "enabled" },
               { label: t("statusFilterDisabled"), value: "disabled" },
             ],
           },
           {
             column: "task_type",
             title: t("typeFilterPlaceholder"),
             options: [
               { label: t("typeCommand"), value: "command" },
               { label: t("typeScript"), value: "script" },
               { label: t("typeSftpUpload"), value: "sftp_upload" },
               { label: t("typeSftpDownload"), value: "sftp_download" },
             ],
           },
         ]}
         onRefresh={handleRefresh}
         showRefresh={true}
         isRefreshing={refreshing}
       />
     )}
   />
 </DashboardPageContent>

 {/* 统一的任务对话框 */}
 <ScheduledTaskDialog
 open={isDialogOpen}
 onOpenChange={setIsDialogOpen}
 mode={dialogMode}
 task={taskForm}
 onTaskChange={setTaskForm}
 servers={servers}
 scripts={scripts}
 onSubmit={dialogMode === "create" ? handleCreateTask : handleUpdateTask}
 onOpenScriptLibrary={() => setIsScriptLibraryOpen(true)}
 t={t}
 />

 {/* 脚本库选择对话框 */}
 <Dialog open={isScriptLibraryOpen} onOpenChange={setIsScriptLibraryOpen}>
 <DialogContent className="max-w-2xl max-h-[80vh]">
 <DialogHeader>
 <DialogTitle>{t("scriptLibraryTitle")}</DialogTitle>
 <DialogDescription>{t("scriptLibraryDescription")}</DialogDescription>
 </DialogHeader>

 <div className="space-y-4">
 <div className="relative">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
 <Input
 placeholder={t("scriptLibrarySearchPlaceholder")}
 className="pl-10"
 value={scriptSearchTerm}
 onChange={(e) => setScriptSearchTerm(e.target.value)}
 />
 </div>

 <div className="border rounded-md max-h-[400px] overflow-y-auto">
 {filteredScripts.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
 <FileText className="h-8 w-8 mb-2" />
 <p className="text-sm">{t("scriptLibraryEmpty")}</p>
 </div>
 ) : (
 <div className="divide-y">
 {filteredScripts.map((script) => (
 <div
 key={script.id}
 className="p-3 hover:bg-accent cursor-pointer"
 onClick={() => handleSelectScript(script)}
 >
 <div className="flex items-start justify-between">
 <div className="flex-1">
 <div className="font-medium">{script.name}</div>
 {script.description && (
 <div className="text-sm text-muted-foreground mt-1">
 {script.description}
 </div>
 )}
 <div className="flex gap-1 mt-2">
 {script.tags.map((tag) => (
 <Badge key={tag} variant="secondary" className="text-xs">
 {tag}
 </Badge>
 ))}
 </div>
 </div>
 </div>
 <div className="mt-2 bg-muted rounded p-2">
 <pre className="text-xs font-mono text-muted-foreground line-clamp-3">
 {script.content}
 </pre>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 </DialogContent>
 </Dialog>
 </>
 )
}
