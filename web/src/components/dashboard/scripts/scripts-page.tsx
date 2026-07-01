
import { useState, useEffect, useMemo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { getErrorMessage } from "@/lib/error-utils"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import { ColumnVisibility } from "@/components/ui/column-visibility"
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog"
import { ArrowLeft, Plus, X, RefreshCw, Search, Check, Terminal, Server as ServerIcon, FileText, Tag, User, Play } from "lucide-react"
import { scriptsApi, serversApi, batchTasksApi, type Script, type Server } from "@/lib/api"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { CreatableCombobox } from "@/components/ui/creatable-combobox"
import { useNavigate } from "react-router-dom"
import { createScriptColumns } from "./script-columns"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import {
  DashboardMetricCard,
  InlineStatusBadge,
} from "@/components/logs/log-dashboard-widgets"

function formatScriptTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export interface ScriptsPageAdapters {
 scripts?: Pick<typeof scriptsApi, "list" | "create" | "update" | "delete" | "execute">
 servers?: Pick<typeof serversApi, "list">
 batchTasks?: Pick<typeof batchTasksApi, "create" | "start">
}

export interface ScriptsPageProps {
 adapters?: ScriptsPageAdapters
 hidePageHeader?: boolean
 onReturnToTerminal?: () => void
 ready?: boolean
 executionRedirectPath?: string | null
 onExecutionStarted?: () => void | Promise<void>
}

export default function ScriptsPage({
 adapters,
 hidePageHeader = false,
 onReturnToTerminal,
 ready: readyOverride,
 executionRedirectPath = "/dashboard/operation-logs?type=execution",
 onExecutionStarted,
}: ScriptsPageProps = {}) {
 const { t } = useTranslation("scripts")
 const navigate = useNavigate()
 const { ready: authReady } = useAuthReady()
 const ready = readyOverride ?? authReady
 const scriptsClient = adapters?.scripts ?? scriptsApi
 const serversClient = adapters?.servers ?? serversApi
 const batchTasksClient = adapters?.batchTasks ?? batchTasksApi
 const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
 const [scripts, setScripts] = useState<Script[]>([])
 const [loading, setLoading] = useState(true)
 const [isDialogOpen, setIsDialogOpen] = useState(false)
 const [editingScriptId, setEditingScriptId] = useState<string | null>(null)
 const [refreshing, setRefreshing] = useState(false)

 // 执行对话框状态
 const [isExecuteDialogOpen, setIsExecuteDialogOpen] = useState(false)
 const [executingScript, setExecutingScript] = useState<Script | null>(null)
 const [servers, setServers] = useState<Server[]>([])
 const [selectedServerIds, setSelectedServerIds] = useState<string[]>([])
 const [executionMode, setExecutionMode] = useState<"parallel" | "sequential">("parallel")
 const [serverSearchQuery, setServerSearchQuery] = useState("")
 const [loadingServers, setLoadingServers] = useState(false)
 const [executing, setExecuting] = useState(false)
 // DataTable 分页与列可见性
 const [page, setPage] = useState(1)
 const [pageSize, setPageSize] = useState(20)
 const [totalPages, setTotalPages] = useState(1)
 const [totalRows, setTotalRows] = useState(0)
 const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
 const [detailDialogMode, setDetailDialogMode] = useState<"view" | "edit">("view")
 const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
   name: true,
   description: false,
   content: false,
   tags: true,
   author: true,
   updated_at: true,
   executions: true,
 })
 const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null)

 // 新建脚本表单状态
 const [newScript, setNewScript] = useState({
 name: "",
 description: "",
 content: "",
 tags: [] as string[],
 })

 // 编辑脚本表单状态
 const [editScript, setEditScript] = useState({
 name: "",
 description: "",
 content: "",
 tags: [] as string[],
 })

 const [tagInput, setTagInput] = useState("")

 const [editTagInput, setEditTagInput] = useState("")

// 加载脚本列表
 const loadScripts = useCallback(async () => {
  try {
     const response = await scriptsClient.list({
       page,
       limit: pageSize,
     })

     setScripts(response.data || [])
     setTotalRows(response.total || (response.data || []).length)
     setTotalPages(response.total_pages || 1)
   } catch (error: unknown) {
     console.error("加载脚本列表失败:", error)
     toast.error(getErrorMessage(error, t("toastLoadFailed")))
   } finally {
     setLoading(false)
     setRefreshing(false)
   }
 }, [page, pageSize, scriptsClient, t])

 // 刷新脚本列表
 const handleRefresh = async () => {
 setRefreshing(true)
 await loadScripts()
}

 // 初始加载与分页变化（仅在已认证且全局状态就绪时触发）
 useEffect(() => {
   if (!ready) return
   setLoading(true)
   loadScripts()
 }, [page, pageSize, loadScripts, ready])

 useEffect(() => {
   if (scripts.length === 0) {
     setSelectedScriptId(null)
     setIsDetailDialogOpen(false)
     return
   }

   if (selectedScriptId && !scripts.some((script) => script.id === selectedScriptId)) {
     setSelectedScriptId(null)
     setIsDetailDialogOpen(false)
   }
 }, [scripts, selectedScriptId])

 // 获取所有标签（安全处理）
 const allTags = Array.from(new Set((scripts || []).flatMap(script => script.tags || [])))

 // 获取可用标签（排除已选择的）
 const availableTags = allTags.filter(tag => !newScript.tags.includes(tag))

 // 编辑模式的可用标签（排除已选择的）
 const availableEditTags = allTags.filter(tag => !editScript.tags.includes(tag))

// 加载服务器列表
const loadServers = useCallback(async () => {
  setLoadingServers(true)
  try {
    const response = await serversClient.list({ limit: 1000 })
    setServers(response.data || [])
  } catch (error: unknown) {
    console.error("加载服务器列表失败:", error)
    toast.error(getErrorMessage(error, t("toastLoadServersFailed")))
  } finally {
    setLoadingServers(false)
  }
}, [serversClient, t])

// 过滤后的服务器列表
const filteredServers = useMemo(() => {
  if (!serverSearchQuery.trim()) return servers
  const query = serverSearchQuery.toLowerCase()
  return servers.filter(
    (server) =>
      server.name?.toLowerCase().includes(query) ||
      server.host.toLowerCase().includes(query)
  )
}, [servers, serverSearchQuery])

// 在线服务器数量
const onlineServersCount = useMemo(() => {
  return servers.filter((s) => s.status === "online").length
}, [servers])

// 已选择的在线服务器数量
const selectedOnlineCount = useMemo(() => {
  return selectedServerIds.filter((id) => {
    const server = servers.find((s) => s.id === id)
    return server?.status === "online"
  }).length
}, [selectedServerIds, servers])

// 事件处理函数 - 使用 useCallback 避免闭包陷阱
const handleExecute = useCallback((scriptId: string) => {
  const script = scripts.find((s) => s.id === scriptId)
  if (script) {
    setExecutingScript(script)
    setSelectedServerIds([])
    setExecutionMode("parallel")
    setServerSearchQuery("")
    setIsExecuteDialogOpen(true)
    loadServers()
  }
}, [scripts, loadServers])

// 执行脚本
const handleExecuteScript = useCallback(async () => {
  if (!executingScript) return

  // 过滤出在线的服务器
  const onlineSelectedIds = selectedServerIds.filter((id) => {
    const server = servers.find((s) => s.id === id)
    return server?.status === "online"
  })

  if (onlineSelectedIds.length === 0) {
    toast.error(t("toastSelectAtLeastOneServer"))
    return
  }

  setExecuting(true)
  try {
    // 创建批量任务
    // 注意: apiFetch 会自动解包 data 字段，所以直接获取 task
    const response = await batchTasksClient.create({
      task_name: `${t("executeTaskPrefix")}: ${executingScript.name}`,
      task_type: "script",
      script_id: executingScript.id,
      content: executingScript.content,
      server_ids: onlineSelectedIds,
      execution_mode: executionMode,
    })
    // response 可能是 { data: BatchTask } 或直接是 BatchTask（取决于 apiFetch 的解包逻辑）
    const task = "data" in response ? response.data : response

    // 启动任务
    await batchTasksClient.start(task.id)

    toast.success(t("toastExecuteStarted"))
    setIsExecuteDialogOpen(false)
    await onExecutionStarted?.()
    await loadScripts()

    if (executionRedirectPath) {
      // 跳转到统一操作日志中的执行记录视图
      navigate(executionRedirectPath)
    }
  } catch (error: unknown) {
    console.error("执行脚本失败:", error)
    toast.error(getErrorMessage(error, t("toastExecuteFailed")))
  } finally {
    setExecuting(false)
  }
}, [batchTasksClient, executingScript, executionMode, executionRedirectPath, loadScripts, navigate, onExecutionStarted, selectedServerIds, servers, t])

// 切换服务器选择
const toggleServerSelection = useCallback((serverId: string) => {
  const server = servers.find((s) => s.id === serverId)
  if (server?.status !== "online") {
    toast.warning(t("toastOnlyOnlineServers"))
    return
  }
  setSelectedServerIds((prev) =>
    prev.includes(serverId)
      ? prev.filter((id) => id !== serverId)
      : [...prev, serverId]
  )
}, [servers, t])

// 全选/取消全选在线服务器
const toggleSelectAllOnline = useCallback(() => {
  const onlineServerIds = filteredServers
    .filter((s) => s.status === "online")
    .map((s) => s.id)

  const allSelected = onlineServerIds.every((id) => selectedServerIds.includes(id))

  if (allSelected) {
    setSelectedServerIds((prev) => prev.filter((id) => !onlineServerIds.includes(id)))
  } else {
    setSelectedServerIds((prev) => {
      const newIds = new Set([...prev, ...onlineServerIds])
      return Array.from(newIds)
    })
  }
}, [filteredServers, selectedServerIds])

// 关闭执行对话框
const handleCloseExecuteDialog = useCallback((open: boolean) => {
  setIsExecuteDialogOpen(open)
  if (!open) {
    setExecutingScript(null)
    setSelectedServerIds([])
    setServerSearchQuery("")
  }
}, [])

 const handleOpenDetail = useCallback((scriptId: string) => {
 setSelectedScriptId(scriptId)
 setDetailDialogMode("view")
 setIsDetailDialogOpen(true)
 }, [])

 const handleEdit = useCallback((scriptId: string) => {
 const script = scripts.find(s => s.id === scriptId)
 if (script) {
 setSelectedScriptId(scriptId)
 setEditingScriptId(scriptId)
 setEditScript({
 name: script.name,
 description: script.description || "",
 content: script.content,
 tags: [...script.tags],
 })
 setDetailDialogMode("edit")
 setIsDetailDialogOpen(true)
 }
 }, [scripts])

 const handleDelete = useCallback(async (scriptId: string) => {
 const confirmed = await requestConfirm({
 description: t("toastDeleteConfirm"),
 variant: "destructive",
 })
 if (!confirmed) {
 return
 }

 try {
 await scriptsClient.delete(scriptId)
 toast.success(t("toastDeleteSuccess"))
 await loadScripts()
 } catch (error: unknown) {
 console.error("删除脚本失败:", error)
 toast.error(getErrorMessage(error, t("toastDeleteFailed")))
 }
 }, [loadScripts, requestConfirm, scriptsClient, t])

// DataTable 列定义与可见列
const columns = useMemo(() => createScriptColumns({
  onExecute: handleExecute,
  onDelete: handleDelete,
  t: (key: string) => t(key),
}), [handleExecute, handleDelete, t])

const visibleColumns = useMemo(
  () => columns.filter((col) =>
    (col.id ? columnVisibility[col.id] ?? true : true)
  ),
  [columns, columnVisibility]
)

// 筛选项（根据现有字段：作者、标签）
const filterOptions = useMemo(() => {
  const tags = Array.from(new Set((scripts || []).flatMap(s => s.tags || []))) as string[]
  const authors = Array.from(new Set((scripts || []).map(s => s.author).filter(Boolean))) as string[]
  return {
    tags: tags.map(t => ({ label: t, value: t })),
    authors: authors.map(a => ({ label: a, value: a })),
  }
}, [scripts])

const tagCounts = useMemo(() => {
  const counts = new Map<string, number>()
  scripts.forEach((script) => {
    ;(script.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))
  })
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}, [scripts])

const selectedScript = useMemo(() => (
  scripts.find((script) => script.id === selectedScriptId) || null
), [scripts, selectedScriptId])

const scriptSpark = useMemo(() => (
  scripts.slice(-12).map((script) => script.executions || 0)
), [scripts])

const totalExecutions = useMemo(() => (
  scripts.reduce((sum, script) => sum + (script.executions || 0), 0)
), [scripts])

 const handleAddTag = (tag?: string) => {
 const tagToAdd = tag || tagInput.trim()
 if (tagToAdd && !newScript.tags.includes(tagToAdd)) {
 setNewScript({
 ...newScript,
 tags: [...newScript.tags, tagToAdd],
 })
 setTagInput("")
 }
 }

 const handleRemoveTag = (tagToRemove: string) => {
 setNewScript({
 ...newScript,
 tags: newScript.tags.filter(tag => tag !== tagToRemove),
 })
 }

 // 编辑模式的标签处理函数
 const handleAddEditTag = (tag?: string) => {
 const tagToAdd = tag || editTagInput.trim()
 if (tagToAdd && !editScript.tags.includes(tagToAdd)) {
 setEditScript({
 ...editScript,
 tags: [...editScript.tags, tagToAdd],
 })
 setEditTagInput("")
 }
 }

 const handleRemoveEditTag = (tagToRemove: string) => {
 setEditScript({
 ...editScript,
 tags: editScript.tags.filter(tag => tag !== tagToRemove),
 })
 }

 const handleCreateScript = async () => {
 if (!newScript.name || !newScript.content) {
 toast.error(t("toastFormIncomplete"))
 return
 }

 try {
 await scriptsClient.create({
  name: newScript.name,
  description: newScript.description || "",
  content: newScript.content,
  language: "bash",
  tags: newScript.tags,
})

 toast.success(t("toastCreateSuccess"))
 setIsDialogOpen(false)

 // 重置表单
 setNewScript({
 name: "",
 description: "",
 content: "",
 tags: [],
 })
 setTagInput("")

 // 重新加载列表
 await loadScripts()
 } catch (error: unknown) {
  console.error("创建脚本失败:", error)
 toast.error(getErrorMessage(error, t("toastCreateFailed")))
 }
 }

 const handleOpenDialog = () => {
 setIsDialogOpen(true)
 }

 const handleCloseDialog = (open: boolean) => {
 setIsDialogOpen(open)
 if (!open) {
 // 重置表单
 setNewScript({
 name: "",
 description: "",
 content: "",
 tags: [],
 })
 setTagInput("")
 }
 }

 const handleUpdateScript = async () => {
 if (!editScript.name || !editScript.content) {
 toast.error(t("toastFormIncomplete"))
 return
 }

 if (editingScriptId === null) return

 try {
 await scriptsClient.update(editingScriptId, {
  name: editScript.name,
  description: editScript.description || "",
  content: editScript.content,
  language: "bash",
  tags: editScript.tags,
})

 toast.success(t("toastUpdateSuccess"))
 setIsDetailDialogOpen(false)
 setDetailDialogMode("view")
 setEditingScriptId(null)

 // 重置表单
 setEditScript({
 name: "",
 description: "",
 content: "",
 tags: [],
 })
 setEditTagInput("")

 // 重新加载列表
 await loadScripts()
 } catch (error: unknown) {
  console.error("更新脚本失败:", error)
 toast.error(getErrorMessage(error, t("toastUpdateFailed")))
 }
 }

 const handleCloseDetailDialog = (open: boolean) => {
 setIsDetailDialogOpen(open)
 if (!open) {
 setEditingScriptId(null)
 setDetailDialogMode("view")
 // 重置表单
 setEditScript({
 name: "",
 description: "",
 content: "",
 tags: [],
 })
 setEditTagInput("")
 }
 }

 return (
 <>
 {confirmDialog}
 {!hidePageHeader && <PageHeader title={t("pageTitle")} />}

 {onReturnToTerminal ? (
   <div className="shrink-0 px-4 pb-1 md:px-4">
     <div className="flex h-9 items-center justify-between gap-2">
       <Button
         type="button"
         variant="ghost"
         size="sm"
         className="-ml-2 h-9 gap-1 bg-transparent px-2 text-sm font-medium text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
         aria-label="返回终端"
         title="返回终端"
         onClick={onReturnToTerminal}
       >
         <ArrowLeft className="size-4" />
         <span>返回终端</span>
       </Button>
       <div />
     </div>
   </div>
 ) : null}

 <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 pt-0 scrollbar-custom sm:gap-4 sm:p-4 sm:pt-0">
   <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
     <DashboardMetricCard title={t("statsTotalScripts")} value={totalRows || scripts.length} icon={FileText} tone="emerald" spark={scriptSpark} loading={loading} />
     <DashboardMetricCard title={t("statsTags")} value={filterOptions.tags.length} icon={Tag} tone="blue" spark={tagCounts.slice(0, 12).map((item) => item.count)} loading={loading} />
     <DashboardMetricCard title={t("statsAuthors")} value={filterOptions.authors.length} icon={User} tone="violet" spark={filterOptions.authors.map(() => 1)} loading={loading} />
     <DashboardMetricCard title="累计执行" value={totalExecutions} icon={Play} tone="amber" spark={scriptSpark} loading={loading} />
   </div>

   <section className="min-h-[520px] shrink-0 overflow-hidden xl:min-h-0 xl:flex-1">
     <DataTable
       data={scripts}
       columns={visibleColumns}
       loading={loading || refreshing}
       currentPage={page}
       pageCount={totalPages}
       pageSize={pageSize}
       totalRows={totalRows}
       onPageChange={setPage}
       onPageSizeChange={(newPageSize) => {
         setPageSize(newPageSize)
         setPage(1)
       }}
       emptyMessage={t("tableEmpty")}
       className="min-h-[520px] overflow-hidden xl:min-h-0"
       scrollContainerClassName="min-h-[360px]"
       density="compact"
       onRowClick={(script) => handleOpenDetail(script.id)}
       getRowClassName={(script) => (
         selectedScriptId === script.id ? "bg-emerald-500/5 hover:bg-emerald-500/10" : undefined
       )}
       toolbar={(table) => (
         <DataTableToolbar
           table={table}
           searchKey="name"
           searchPlaceholder={t("tableSearchPlaceholder")}
           filters={[
             { column: 'author', title: t("filterAuthorTitle"), options: filterOptions.authors },
             { column: 'tags', title: t("filterTagsTitle"), options: filterOptions.tags },
           ]}
           onRefresh={handleRefresh}
           showRefresh={true}
           isRefreshing={refreshing}
         >
           <ColumnVisibility
             columns={[
               { id: 'name', label: t("cvName") },
               { id: 'description', label: t("cvDescription") },
               { id: 'content', label: t("cvContent") },
               { id: 'tags', label: t("cvTags") },
               { id: 'author', label: t("cvAuthor") },
               { id: 'updated_at', label: t("cvUpdatedAt") },
               { id: 'executions', label: t("cvExecutions") },
             ].map(column => ({
               id: column.id,
               label: column.label,
               visible: columnVisibility[column.id] ?? true,
               onToggle: () => setColumnVisibility(prev => ({
                 ...prev,
                 [column.id]: !prev[column.id]
               }))
             }))}
           />
           <Button size="sm" onClick={handleOpenDialog}>
             <Plus className="mr-2 h-4 w-4" />
             {t("btnNew")}
           </Button>
         </DataTableToolbar>
       )}
     />
   </section>
 </div>

 {/* 脚本详情/编辑合并弹窗 */}
 <Dialog open={isDetailDialogOpen} onOpenChange={handleCloseDetailDialog}>
 <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
 <DialogHeader className="shrink-0 pr-8">
 <div className="flex flex-wrap items-center gap-2">
 <DialogTitle>{detailDialogMode === "edit" ? t("editDialogTitle") : "脚本详情"}</DialogTitle>
 {selectedScript && <InlineStatusBadge label={selectedScript.language || "bash"} tone="blue" />}
 </div>
 <DialogDescription>
 {detailDialogMode === "edit" ? t("editDialogDescription") : "查看脚本标签、内容、执行次数和最近更新时间。"}
 </DialogDescription>
 </DialogHeader>

 {selectedScript && detailDialogMode === "view" ? (
 <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2 scrollbar-custom">
 <div>
 <h3 className="text-base font-semibold">{selectedScript.name}</h3>
 <p className="mt-1 text-sm text-muted-foreground">{selectedScript.description || "暂无描述"}</p>
 </div>
 <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
 <div className="rounded-md bg-muted/50 p-3">
 <div className="text-xs text-muted-foreground">执行次数</div>
 <div className="mt-1 font-semibold tabular-nums">{selectedScript.executions || 0}</div>
 </div>
 <div className="rounded-md bg-muted/50 p-3">
 <div className="text-xs text-muted-foreground">作者</div>
 <div className="mt-1 truncate font-semibold">{selectedScript.author || "-"}</div>
 </div>
 <div className="rounded-md bg-muted/50 p-3">
 <div className="text-xs text-muted-foreground">创建时间</div>
 <div className="mt-1 truncate font-semibold tabular-nums">{formatScriptTime(selectedScript.created_at)}</div>
 </div>
 <div className="rounded-md bg-muted/50 p-3">
 <div className="text-xs text-muted-foreground">更新时间</div>
 <div className="mt-1 truncate font-semibold tabular-nums">{formatScriptTime(selectedScript.updated_at)}</div>
 </div>
 </div>
 <div className="flex flex-wrap gap-1.5">
 {(selectedScript.tags || []).length === 0 ? (
 <InlineStatusBadge label="未分类" tone="slate" />
 ) : selectedScript.tags.map((tag) => (
 <InlineStatusBadge key={tag} label={tag} tone="violet" />
 ))}
 </div>
 <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground">{selectedScript.content}</pre>
 </div>
 ) : null}

 {selectedScript && detailDialogMode === "edit" ? (
 <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2 scrollbar-custom">
 <div className="space-y-2">
 <Label htmlFor="detail-edit-script-name">
 {t("fieldNameLabel")} <span className="text-destructive">*</span>
 </Label>
 <Input
 id="detail-edit-script-name"
 placeholder={t("fieldNamePlaceholder")}
 value={editScript.name}
 onChange={(e) => setEditScript({ ...editScript, name: e.target.value })}
 />
 </div>

 <div className="space-y-2">
 <Label htmlFor="detail-edit-script-description">{t("fieldDescriptionLabel")}</Label>
 <Input
 id="detail-edit-script-description"
 placeholder={t("fieldDescriptionPlaceholder")}
 value={editScript.description}
 onChange={(e) => setEditScript({ ...editScript, description: e.target.value })}
 />
 </div>

 <div className="space-y-2">
 <Label htmlFor="detail-edit-script-content">
 {t("fieldContentLabel")} <span className="text-destructive">*</span>
 </Label>
 <Textarea
 id="detail-edit-script-content"
 placeholder="#!/bin/bash&#10;&#10;echo 'Hello World'"
 className="min-h-[240px] font-mono"
 value={editScript.content}
 onChange={(e) => setEditScript({ ...editScript, content: e.target.value })}
 />
 <p className="text-xs text-muted-foreground">
 {t("fieldContentHint")}
 </p>
 </div>

 <div className="space-y-2">
 <Label htmlFor="detail-edit-script-tags">{t("fieldTagsLabel")}</Label>
 <CreatableCombobox
 id="detail-edit-script-tags"
 value={editTagInput}
 onValueChange={setEditTagInput}
 options={availableEditTags.map((tag) => ({ value: tag, label: tag }))}
 onSelect={handleAddEditTag}
 placeholder={t("tagsInputPlaceholder")}
 />

 {editScript.tags.length > 0 && (
 <div className="mt-2 flex flex-wrap gap-2">
 {editScript.tags.map((tag) => (
 <Badge key={tag} variant="secondary" className="gap-1">
 {tag}
 <button
 type="button"
 onClick={() => handleRemoveEditTag(tag)}
 className="ml-1 hover:text-destructive"
 >
 <X className="h-3 w-3" />
 </button>
 </Badge>
 ))}
 </div>
 )}
 </div>
 </div>
 ) : null}

 {!selectedScript ? (
 <div className="py-10 text-center text-sm text-muted-foreground">{t("tableEmpty")}</div>
 ) : null}

 {selectedScript && detailDialogMode === "view" ? (
 <DialogFooter className="shrink-0">
 <Button
 variant="outline"
 onClick={() => handleEdit(selectedScript.id)}
 >
 编辑
 </Button>
 <Button
 onClick={() => {
 setIsDetailDialogOpen(false)
 handleExecute(selectedScript.id)
 }}
 >
 <Play className="mr-2 h-4 w-4" />
 执行
 </Button>
 </DialogFooter>
 ) : null}
 {selectedScript && detailDialogMode === "edit" ? (
 <DialogFooter className="shrink-0">
 <Button
 variant="outline"
 onClick={() => {
 setEditScript({
 name: selectedScript.name,
 description: selectedScript.description || "",
 content: selectedScript.content,
 tags: [...selectedScript.tags],
 })
 setEditTagInput("")
 setEditingScriptId(null)
 setDetailDialogMode("view")
 }}
 >
 {t("dialogCancel")}
 </Button>
 <Button onClick={handleUpdateScript}>
 {t("editDialogSave")}
 </Button>
 </DialogFooter>
 ) : null}
 </DialogContent>
 </Dialog>

 {/* 新建脚本弹窗 */}
 <Dialog open={isDialogOpen} onOpenChange={handleCloseDialog}>
 <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
 <DialogHeader className="shrink-0">
 <DialogTitle>新建脚本</DialogTitle>
 <DialogDescription>
 创建一个新的脚本模板，可以在任务中使用
 </DialogDescription>
 </DialogHeader>

 <div className="space-y-4 px-1 py-4 flex-1 min-h-0 overflow-y-auto scrollbar-custom">
{/* 脚本名称 */}
<div className="space-y-2">
<Label htmlFor="script-name">
{t("fieldNameLabel")} <span className="text-destructive">*</span>
</Label>
<Input
id="script-name"
placeholder={t("fieldNamePlaceholder")}
 value={newScript.name}
 onChange={(e) => setNewScript({ ...newScript, name: e.target.value })}
 />
 </div>

{/* 脚本描述 */}
<div className="space-y-2">
<Label htmlFor="script-description">{t("fieldDescriptionLabel")}</Label>
<Input
id="script-description"
placeholder={t("fieldDescriptionPlaceholder")}
 value={newScript.description}
 onChange={(e) => setNewScript({ ...newScript, description: e.target.value })}
 />
 </div>

 {/* 脚本内容 */}
 <div className="space-y-2">
 <Label htmlFor="script-content">
 {t("fieldContentLabel")} <span className="text-destructive">*</span>
 </Label>
 <Textarea
 id="script-content"
 placeholder="#!/bin/bash&#10;&#10;echo 'Hello World'"
 className="font-mono min-h-[200px]"
 value={newScript.content}
 onChange={(e) => setNewScript({ ...newScript, content: e.target.value })}
 />
 <p className="text-xs text-muted-foreground">
 {t("fieldContentHint")}
 </p>
 </div>

 {/* 标签 */}
 <div className="space-y-2">
 <Label htmlFor="script-tags">{t("fieldTagsLabel")}</Label>
 <CreatableCombobox
 id="script-tags"
 value={tagInput}
 onValueChange={setTagInput}
 options={availableTags.map((tag) => ({ value: tag, label: tag }))}
 onSelect={handleAddTag}
 placeholder={t("tagsInputPlaceholder")}
 />

 {/* 已添加的标签 */}
 {newScript.tags.length > 0 && (
 <div className="flex flex-wrap gap-2 mt-2">
 {newScript.tags.map((tag) => (
 <Badge key={tag} variant="secondary" className="gap-1">
 {tag}
 <button
 type="button"
 onClick={() => handleRemoveTag(tag)}
 className="ml-1 hover:text-destructive"
 >
 <X className="h-3 w-3" />
 </button>
 </Badge>
 ))}
 </div>
 )}
 </div>
 </div>

 <DialogFooter className="shrink-0">
 <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
 {t("dialogCancel")}
 </Button>
 <Button onClick={handleCreateScript}>
 {t("dialogCreateSubmit")}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* 执行脚本对话框 */}
 <Dialog open={isExecuteDialogOpen} onOpenChange={handleCloseExecuteDialog}>
   <DialogContent className="max-w-md max-h-[85vh] flex flex-col gap-0">
     <DialogHeader className="shrink-0 pb-4">
       <DialogTitle className="flex items-center gap-2">
         <Terminal className="h-5 w-5" />
         {t("executeDialogTitle")}
       </DialogTitle>
       <DialogDescription className="flex items-center gap-2 pt-1">
         <Badge variant="outline" className="font-mono text-xs">
           {executingScript?.name}
         </Badge>
       </DialogDescription>
     </DialogHeader>

     <div className="space-y-4 flex-1 min-h-0 overflow-y-auto scrollbar-custom">
       {/* 选择目标服务器 */}
       <div className="space-y-3">
         <div className="flex items-center justify-between">
           <Label className="text-sm font-medium">{t("executeSelectServers")}</Label>
           <span className="text-xs text-muted-foreground">
             {t("executeSelectedSummary", {
               selected: selectedOnlineCount,
               online: onlineServersCount,
             })}
           </span>
         </div>

         {/* 搜索框和全选 */}
         <div className="flex items-center gap-2">
           <div className="relative flex-1">
             <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
             <Input
               placeholder={t("executeSearchPlaceholder")}
               value={serverSearchQuery}
               onChange={(e) => setServerSearchQuery(e.target.value)}
               className="pl-8 h-9"
             />
           </div>
           <Button
             variant="outline"
             size="sm"
             onClick={toggleSelectAllOnline}
             className="h-9 px-3 text-xs whitespace-nowrap"
           >
             {filteredServers.filter((s) => s.status === "online").every((s) => selectedServerIds.includes(s.id))
               ? t("executeUnselectAll")
               : t("executeSelectAll")}
           </Button>
         </div>

         {/* 服务器列表 */}
         <ScrollArea className="h-[240px] rounded-md border bg-muted/30">
           {loadingServers ? (
             <div className="p-2 space-y-1">
               {Array.from({ length: 4 }).map((_, i) => (
                 <div key={i} className="flex items-center gap-3 p-2.5 rounded-md border border-transparent">
                   <Skeleton className="h-4 w-4 rounded" />
                   <div className="flex-1 space-y-1.5">
                     <Skeleton className="h-4 w-32" />
                     <Skeleton className="h-3 w-24" />
                   </div>
                   <Skeleton className="h-2 w-2 rounded-full" />
                 </div>
               ))}
             </div>
           ) : filteredServers.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-[220px] gap-2 text-muted-foreground">
               <ServerIcon className="h-8 w-8 opacity-50" />
               <span className="text-sm">{t("executeNoServers")}</span>
             </div>
           ) : (
             <div className="p-2 space-y-1">
               {filteredServers.map((server) => {
                 const isOnline = server.status === "online"
                 const isSelected = selectedServerIds.includes(server.id)
                 return (
                   <div
                     key={server.id}
                     className={`flex items-center gap-3 p-2.5 rounded-md transition-all ${
                       isOnline
                         ? isSelected
                           ? "bg-primary/10 border border-primary/30"
                           : "hover:bg-accent/50 cursor-pointer border border-transparent"
                         : "opacity-40 cursor-not-allowed border border-transparent"
                     }`}
                     onClick={() => toggleServerSelection(server.id)}
                   >
                     <Checkbox
                       checked={isSelected}
                       disabled={!isOnline}
                       onCheckedChange={() => toggleServerSelection(server.id)}
                       className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                     />
                     <div className="flex-1 min-w-0">
                       <p className="text-sm font-medium truncate">
                         {server.name || server.host}
                       </p>
                       <p className="text-xs text-muted-foreground truncate font-mono">
                         {server.host}:{server.port}
                       </p>
                     </div>
                     <div className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? "bg-green-500" : "bg-gray-400"}`} />
                   </div>
                 )
               })}
             </div>
           )}
         </ScrollArea>
       </div>

       {/* 执行模式 */}
       <div className="space-y-3 pt-2">
         <Label className="text-sm font-medium">{t("executeMode")}</Label>
         <RadioGroup
           value={executionMode}
           onValueChange={(value) => setExecutionMode(value as "parallel" | "sequential")}
           className="grid grid-cols-2 gap-3"
         >
           <Label
             htmlFor="parallel"
             className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-all ${
               executionMode === "parallel"
                 ? "border-primary bg-primary/5"
                 : "border-border hover:bg-accent/50"
             }`}
           >
             <RadioGroupItem value="parallel" id="parallel" />
             <span className="text-sm">{t("executeModeParallel")}</span>
           </Label>
           <Label
             htmlFor="sequential"
             className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-all ${
               executionMode === "sequential"
                 ? "border-primary bg-primary/5"
                 : "border-border hover:bg-accent/50"
             }`}
           >
             <RadioGroupItem value="sequential" id="sequential" />
             <span className="text-sm">{t("executeModeSequential")}</span>
           </Label>
         </RadioGroup>
       </div>
     </div>

     <DialogFooter className="shrink-0 pt-4 border-t mt-4">
       <Button variant="outline" onClick={() => setIsExecuteDialogOpen(false)}>
         {t("dialogCancel")}
       </Button>
       <Button
         onClick={handleExecuteScript}
         disabled={executing || selectedOnlineCount === 0}
       >
         {executing ? (
           <>
             <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
             {t("executeRunning")}
           </>
         ) : (
           <>
             <Check className="mr-2 h-4 w-4" />
             {t("executeSubmit")}
           </>
         )}
       </Button>
     </DialogFooter>
   </DialogContent>
 </Dialog>
 </>
 )
}
