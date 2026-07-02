
import { useState, useEffect, useMemo, useCallback } from "react"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { getErrorMessage } from "@/lib/error-utils"
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
import {
 Plus,
 Search,
 FileText,
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
import { useTranslation } from "react-i18next"
import { createScheduledTaskColumns } from "./automation/schedules/components/scheduled-task-columns"
import {
  InlineStatusBadge,
} from "@/components/logs/log-dashboard-widgets"
import { ScheduledTaskDialog } from "./automation/schedules/components/scheduled-task-dialog"

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

const getTaskTypeLabel = (type: ScheduledTaskType, t: (key: string) => string) => {
 if (type === "command") return t("typeCommand")
 if (type === "script") return t("typeScript")
 if (type === "batch") return t("typeBatch")
 if (type === "sftp_upload") return "SFTP 上传"
 if (type === "sftp_download") return "SFTP 下载"
 return type
}

const getTaskTypeTone = (type: ScheduledTaskType) => {
 if (type === "command") return "blue" as const
 if (type === "script") return "violet" as const
 if (type === "batch") return "amber" as const
 if (type === "sftp_upload") return "emerald" as const
 if (type === "sftp_download") return "cyan" as const
 return "slate" as const
}

const isSftpTaskType = (type: ScheduledTaskType) => (
 type === "sftp_upload" || type === "sftp_download"
)

export default function AutomationSchedulesPage() {
 const { ready } = useAuthReady()
 const { user } = useClientAuth()
 const { data: systemConfig } = useSystemConfig()
 const effectiveLocale = getEffectiveLocale(user, systemConfig || null)
 const effectiveTimezone = getEffectiveTimezone(user, systemConfig || null)
 const { t } = useTranslation("automationSchedules")
 const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
 // 数据状态
 const [tasks, setTasks] = useState<ScheduledTask[]>([])
 const [servers, setServers] = useState<Server[]>([])
 const [scripts, setScripts] = useState<Script[]>([])
 const [loading, setLoading] = useState(true)
 const [refreshing, setRefreshing] = useState(false)

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
 timezone: "Asia/Shanghai",
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

 // 加载所有数据
 const loadData = async () => {
 try {
// 并行加载所有数据
 const [tasksRes, serversRes, scriptsRes] = await Promise.all([
 scheduledTasksApi.list({ page: 1, limit: 100 }),
 serversApi.list(),
 scriptsApi.list({ page: 1, limit: 100 }),
 ])

 // 现在 apiFetch 不会解包包含分页元数据的响应，直接访问 data 字段
 const tasksList = Array.isArray(tasksRes?.data) ? tasksRes.data : []
 const serversList = Array.isArray(serversRes?.data) ? serversRes.data : []
 const scriptsList = Array.isArray(scriptsRes?.data) ? scriptsRes.data : []
 setTasks(Array.isArray(tasksList) ? tasksList : [])
 setServers(Array.isArray(serversList) ? serversList : [])
 setScripts(Array.isArray(scriptsList) ? scriptsList : [])
 } catch (error: unknown) {
 console.error("加载数据失败:", error)

 // 确保状态为空数组，避免undefined错误
 setTasks([])
 setServers([])
 setScripts([])

 toast.error(getErrorMessage(error, "加载数据失败"))
 } finally {
 setLoading(false)
 setRefreshing(false)
 }
 }

 // 刷新数据
 const handleRefresh = async () => {
 setRefreshing(true)
 await loadData()
 }

 // 初始加载（仅在已认证且全局状态就绪时触发）
 useEffect(() => {
   if (!ready) return
   loadData()
 }, [ready])


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
 setTaskForm({
 task_name: "",
 description: "",
 task_type: "command",
 command: "",
 script_id: null,
 cron_expression: "",
 timezone: "Asia/Shanghai",
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
 }, [])

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

 if (taskForm.task_type === "script" && !taskForm.script_id && !taskForm.command) {
 toast.error(t("toastScriptRequired"))
 return
 }

 if (!isSftpTask && taskForm.server_ids.length === 0) {
 toast.error(t("toastSelectServer"))
 return
 }

 if (isSftpUpload && (!taskForm.sftp_server_id || !taskForm.sftp_target_path || !taskForm.sftp_upload_file)) {
 toast.error("请选择 SFTP 服务器、目标目录和要暂存的文件")
 return
 }

 if (isSftpDownload && (!taskForm.sftp_server_id || !taskForm.sftp_source_path)) {
 toast.error("请选择 SFTP 服务器并填写远端文件路径")
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
 setEditingTaskId(task.id)
 setTaskForm({
 task_name: task.task_name,
 description: task.description || "",
 task_type: task.task_type,
 command: task.command || "",
 script_id: null,
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

 if (!isSftpTask && taskForm.server_ids.length === 0) {
 toast.error(t("toastSelectServer"))
 return
 }

 if (isSftpUpload && (!taskForm.sftp_server_id || !taskForm.sftp_target_path || (!taskForm.sftp_staged_job_id && !taskForm.sftp_upload_file))) {
 toast.error("SFTP 上传任务需要服务器、目标目录和暂存文件")
 return
 }

 if (isSftpDownload && (!taskForm.sftp_server_id || !taskForm.sftp_source_path)) {
 toast.error("SFTP 下载任务需要服务器和远端文件路径")
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
 command: isSftpTask ? undefined : taskForm.command || undefined,
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

 await scheduledTasksApi.trigger(taskId)
 toast.success(t("toastTriggerSuccess"))
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
 formatDate,
 })

 const upcomingTasks = useMemo(() => (
 [...tasks]
 .filter((task) => task.enabled && task.next_run_at)
 .sort((a, b) => new Date(a.next_run_at || 0).getTime() - new Date(b.next_run_at || 0).getTime())
 .slice(0, 5)
 ), [tasks])

 return (
 <>
 {confirmDialog}
 <PageHeader title={t("pageTitle")} />

 <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0 xl:overflow-hidden">
   <div className="flex shrink-0 flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
     <p>集中查看定时任务、执行节奏和失败风险，便于快速判断调度状态。</p>
     <div className="flex items-center gap-2">
       <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
       <span>调度服务运行中</span>
     </div>
   </div>

   <Card className="shrink-0 gap-0 p-4 sm:p-5">
     <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
       <div>
         <h2 className="text-base font-semibold">调度时间线</h2>
         <p className="mt-1 text-sm text-muted-foreground">最近准备执行的任务按时间排列，便于快速确认下一批执行窗口。</p>
       </div>
       <Button size="sm" onClick={handleOpenCreateDialog}>
         <Plus className="mr-2 h-4 w-4" />
         {t("newTask")}
       </Button>
     </div>
     <div className="mt-4 grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
       {upcomingTasks.length === 0 ? (
         <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground md:col-span-2 2xl:col-span-4">
           {t("emptyAll")}
         </div>
       ) : upcomingTasks.slice(0, 4).map((task) => (
         <div key={task.id} className="rounded-md border bg-background p-3">
           <div className="flex items-start justify-between gap-3">
             <div className="min-w-0">
               <div className="truncate text-sm font-medium">{task.task_name}</div>
               <div className="mt-1 truncate text-xs text-muted-foreground">{task.cron_expression}</div>
             </div>
             <InlineStatusBadge
               label={getTaskTypeLabel(task.task_type, t)}
               tone={getTaskTypeTone(task.task_type)}
             />
           </div>
           <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
             <span>{formatDate(task.next_run_at)}</span>
             <span className="tabular-nums">{(task.server_ids || []).length} 台</span>
           </div>
         </div>
       ))}
     </div>
   </Card>

   <div className="min-h-0 flex-1 overflow-hidden">
     <DataTable
       data={tasks}
       columns={columns}
       loading={loading || refreshing}
       emptyMessage={t("emptyAll")}
       enableRowSelection={true}
       getRowId={(task) => task.id}
       className="min-h-0 overflow-hidden"
       scrollContainerClassName="min-h-[360px]"
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
                 { label: t("typeBatch"), value: "batch" },
                 { label: "SFTP 上传", value: "sftp_upload" },
                 { label: "SFTP 下载", value: "sftp_download" },
               ],
             },
           ]}
           onRefresh={handleRefresh}
           showRefresh={true}
           isRefreshing={refreshing}
         >
           <Button size="sm" onClick={() => setIsDialogOpen(true)}>
             <Plus className="mr-2 h-4 w-4" />
             {t("newTask")}
           </Button>
         </DataTableToolbar>
       )}
     />
   </div>
 </div>

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
