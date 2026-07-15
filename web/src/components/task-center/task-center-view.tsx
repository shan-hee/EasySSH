import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { TFunction } from "i18next"
import type { ColumnDef } from "@tanstack/react-table"
import { AlertTriangle, CheckCircle2, CircleStop, Clock3, Eye, Loader2, MoreHorizontal, RotateCcw, Search, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/page-header"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"
import { DataTable } from "@/components/ui/data-table"
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  SubscribeRealtimeEvents,
  TaskCenterApi,
  TaskEvent,
  TaskRun,
  TaskRunStatus,
  TaskStatistics,
} from "@/components/task-center/task-center-contracts"
import { getErrorMessage } from "@/lib/error-utils"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const emptyStatistics: TaskStatistics = { total: 0, queued: 0, running: 0, canceling: 0, succeeded: 0, failed: 0, partial_success: 0, canceled: 0, timeout: 0 }

export interface TaskCenterViewProps {
  api: TaskCenterApi
  subscribeEvents?: SubscribeRealtimeEvents | null
  hidePageHeader?: boolean
  schedulesContent?: ReactNode
  requestedRunID?: string | null
  onClearRequestedRun?: () => void
}

export function TaskCenterView({
  api,
  subscribeEvents = null,
  hidePageHeader = false,
  schedulesContent,
  requestedRunID: externalRequestedRunID,
  onClearRequestedRun,
}: TaskCenterViewProps) {
  const { t, i18n } = useTranslation("taskCenter")
  const [runs, setRuns] = useState<TaskRun[]>([])
  const [statistics, setStatistics] = useState<TaskStatistics>(emptyStatistics)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalPages, setTotalPages] = useState(1)
  const [totalRuns, setTotalRuns] = useState(0)
  const [statusFilter, setStatusFilter] = useState("active")
  const [taskTypeFilters, setTaskTypeFilters] = useState<string[]>([])
  const [triggerFilters, setTriggerFilters] = useState<TaskRun["trigger_type"][]>([])
  const [keyword, setKeyword] = useState("")
  const deferredKeyword = useDeferredValue(keyword.trim())
  const [selected, setSelected] = useState<{ run: TaskRun; events: TaskEvent[] } | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [retentionDays, setRetentionDays] = useState("90")
  const handledRequestedRunRef = useRef<string | null>(null)

  const load = useCallback(async (silent = false, requestedPage = page) => {
    if (!silent) setLoading(true)
    try {
      const status = statusFilter === "active"
        ? ["queued", "running", "canceling"] as TaskRunStatus[]
        : statusFilter === "all" ? undefined : [statusFilter as TaskRunStatus]
      const [list, stats] = await Promise.all([api.list({
        status,
        task_type: taskTypeFilters.length > 0 ? taskTypeFilters : undefined,
        trigger_type: triggerFilters.length > 0 ? triggerFilters : undefined,
        keyword: deferredKeyword || undefined,
        page: requestedPage,
        page_size: pageSize,
      }), api.statistics()])
      setRuns(list.runs ?? [])
      setTotalPages(Math.max(1, list.total_pages ?? 1))
      setTotalRuns(list.total ?? 0)
      setStatistics(stats)
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error, t("loadFailed")))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [api, deferredKeyword, page, pageSize, statusFilter, t, taskTypeFilters, triggerFilters])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 60000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!subscribeEvents) return
    let refreshTimer: number | null = null
    const changedTaskIDs = new Set<string>()
    const unsubscribe = subscribeEvents((event) => {
      if (!event.type.startsWith("task.")) return
      if (typeof event.data.task_id === "string") changedTaskIDs.add(event.data.task_id)
      if (refreshTimer !== null) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void load(true)
        if (selected?.run.id && (changedTaskIDs.size === 0 || changedTaskIDs.has(selected.run.id))) {
          void api.get(selected.run.id).then(setSelected).catch(() => undefined)
        }
        changedTaskIDs.clear()
      }, 250)
    })
    return () => {
      unsubscribe()
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
    }
  }, [api, load, selected?.run.id, subscribeEvents])

  const openDetails = useCallback(async (run: TaskRun) => {
    try {
      setSelected(await api.get(run.id))
    } catch (error) {
      toast.error(getErrorMessage(error, t("detailsLoadFailed")))
    }
  }, [api, t])

  const requestedRunID = externalRequestedRunID ?? null
  const clearRequestedRun = useCallback(() => {
    if (!requestedRunID) return
    handledRequestedRunRef.current = requestedRunID
    onClearRequestedRun?.()
  }, [onClearRequestedRun, requestedRunID])

  useEffect(() => {
    if (!requestedRunID) {
      handledRequestedRunRef.current = null
      return
    }
    if (handledRequestedRunRef.current === requestedRunID) return
    handledRequestedRunRef.current = requestedRunID
    void api.get(requestedRunID).then(setSelected).catch((error) => {
      toast.error(getErrorMessage(error, t("detailsLoadFailed")))
      clearRequestedRun()
    })
  }, [api, clearRequestedRun, requestedRunID, t])

  const runAction = useCallback(async (action: "cancel" | "retry", run: TaskRun) => {
    try {
      if (action === "cancel") await api.cancel(run.id)
      else await api.retry(run.id)
      toast.success(t(action === "cancel" ? "cancelRequested" : "retrySubmitted"))
      setSelected(null)
      clearRequestedRun()
      await load()
    } catch (error) {
      toast.error(getErrorMessage(error, t(action === "cancel" ? "cancelFailed" : "retryFailed")))
    }
  }, [api, clearRequestedRun, load, t])

  const cleanupRuns = useCallback(async () => {
    const parsedRetentionDays = Number(retentionDays)
    if (!Number.isInteger(parsedRetentionDays) || parsedRetentionDays < 1 || parsedRetentionDays > 3650) {
      toast.error(t("cleanupInvalidRetention"))
      return
    }
    try {
      setCleanupLoading(true)
      const result = await api.cleanup(parsedRetentionDays)
      toast.success(t("cleanupSuccess", { count: result.deleted_count }))
      setCleanupOpen(false)
      setSelected(null)
      clearRequestedRun()
      setPage(1)
      await load(false, 1)
    } catch (error) {
      toast.error(getErrorMessage(error, t("cleanupFailed")))
    } finally {
      setCleanupLoading(false)
    }
  }, [api, clearRequestedRun, load, retentionDays, t])

  const metricItems = useMemo(() => [
    { label: t("metricAll"), value: statistics.total, icon: Clock3 },
    { label: t("metricActive"), value: statistics.running + statistics.queued + statistics.canceling, icon: Loader2 },
    { label: t("metricSucceeded"), value: statistics.succeeded, icon: CheckCircle2 },
    { label: t("metricAttention"), value: statistics.failed + statistics.partial_success + statistics.timeout, icon: AlertTriangle },
  ], [statistics, t])

  const runColumns = useMemo<ColumnDef<TaskRun>[]>(() => {
    const meta = (value: DataTableColumnMeta): DataTableColumnMeta => value
    return [
      {
        id: "task",
        accessorFn: (run) => `${run.title} ${run.resource || run.server_name || ""}`,
        header: t("columnTask"),
        size: 420,
        minSize: 260,
        meta: meta({ align: "left" }),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.title}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.original.resource || row.original.server_name || "-"}</div>
          </div>
        ),
      },
      {
        id: "type",
        accessorKey: "task_type",
        header: t("columnType"),
        size: 150,
        minSize: 120,
        meta: meta({ align: "left" }),
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{taskTypeLabel(row.original.task_type, t)}</span>,
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("columnStatus"),
        size: 120,
        minSize: 100,
        meta: meta({ align: "left" }),
        cell: ({ row }) => <TaskStatusBadge status={row.original.status} t={t} />,
      },
      {
        id: "progress",
        accessorKey: "progress",
        header: t("columnProgress"),
        size: 210,
        minSize: 170,
        meta: meta({ align: "left" }),
        cell: ({ row }) => <TaskProgress run={row.original} t={t} />,
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: t("columnCreatedAt"),
        size: 170,
        minSize: 150,
        meta: meta({ align: "left" }),
        cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(row.original.created_at, i18n.language)}</span>,
      },
      {
        id: "actions",
        header: t("columnActions"),
        size: 72,
        minSize: 72,
        meta: meta({ align: "center" }),
        cell: ({ row }) => {
          const run = row.original
          const canCancel = run.cancelable && ["queued", "running"].includes(run.status)
          const canRetry = run.retryable && ["failed", "partial_success", "canceled", "timeout"].includes(run.status)
          return (
            <div className="flex justify-center" onClick={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" title={t("taskActions")} aria-label={t("taskActions")}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void openDetails(run)}>
                    <Eye className="size-4" />
                    {t("viewDetails")}
                  </DropdownMenuItem>
                  {canCancel || canRetry ? <DropdownMenuSeparator /> : null}
                  {canCancel ? (
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void runAction("cancel", run)}>
                      <CircleStop className="size-4" />
                      {t("cancelTask")}
                    </DropdownMenuItem>
                  ) : null}
                  {canRetry ? (
                    <DropdownMenuItem onClick={() => void runAction("retry", run)}>
                      <RotateCcw className="size-4" />
                      {t("retryTask")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ]
  }, [i18n.language, openDetails, runAction, t])

  return (
    <>
      {!hidePageHeader ? <PageHeader title={t("title")} /> : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 sm:px-4 sm:pb-4">
        <Tabs defaultValue="runs" className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center border-b pb-3">
            <TabsList>
              <TabsTrigger value="runs">{t("runsTab")}</TabsTrigger>
              {schedulesContent ? <TabsTrigger value="schedules">{t("schedulesTab")}</TabsTrigger> : null}
            </TabsList>
          </div>

          <TabsContent value="runs" className="min-h-0 flex-1 flex-col overflow-hidden pt-3 data-[state=active]:flex">
            <div className="grid border-y sm:grid-cols-2 xl:grid-cols-4">
              {metricItems.map(({ label, value, icon: Icon }, index) => (
                <div key={label} className={cn("flex h-20 items-center gap-3 px-4", index > 0 && "border-t sm:border-t-0 sm:border-l", index === 2 && "sm:border-t xl:border-t-0")}>
                  <Icon className="size-4 text-muted-foreground" />
                  <div><div className="text-xl font-semibold tabular-nums">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
                </div>
              ))}
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-hidden">
              <DataTable
                data={runs}
                columns={runColumns}
                loading={loading}
                currentPage={page}
                pageCount={totalPages}
                pageSize={pageSize}
                totalRows={totalRuns}
                onPageChange={setPage}
                onPageSizeChange={(value) => { setPage(1); setPageSize(value) }}
                emptyMessage={t("empty")}
                density="compact"
                className="min-h-0 overflow-hidden"
                scrollContainerClassName="min-h-[260px]"
                onRowClick={(run) => void openDetails(run)}
                toolbar={(table) => (
                  <DataTableToolbar
                    table={table}
                    showRefresh
                    onRefresh={() => void load()}
                    isRefreshing={loading}
                    filterSlot={(
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <div className="flex flex-wrap gap-1">
                          {[
                            ["active", t("filterActive")], ["all", t("filterAll")], ["succeeded", t("filterSucceeded")], ["failed", t("filterFailed")],
                            ["partial_success", t("filterPartial")], ["timeout", t("filterTimeout")], ["canceled", t("filterCanceled")],
                          ].map(([value, label]) => (
                            <Button key={value} variant={statusFilter === value ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => { setPage(1); setStatusFilter(value) }}>{label}</Button>
                          ))}
                        </div>
                        <div className="relative min-w-[180px] flex-1 xl:max-w-[280px]">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input value={keyword} onChange={(event) => { setPage(1); setKeyword(event.target.value) }} placeholder={t("searchPlaceholder")} className="h-8 pl-8" />
                        </div>
                        <DataTableFacetedFilter
                          title={t("typeFilterPlaceholder")}
                          options={Object.entries(taskTypeLabelKeys).map(([value, key]) => ({ value, label: t(key) }))}
                          values={taskTypeFilters}
                          onValuesChange={(values) => { setPage(1); setTaskTypeFilters(values) }}
                        />
                        <DataTableFacetedFilter
                          title={t("triggerFilterPlaceholder")}
                          options={[
                            { value: "manual", label: t("triggerManual") },
                            { value: "scheduled", label: t("triggerScheduled") },
                            { value: "system", label: t("triggerSystem") },
                            { value: "api", label: t("triggerApi") },
                          ]}
                          values={triggerFilters}
                          onValuesChange={(values) => { setPage(1); setTriggerFilters(values as TaskRun["trigger_type"][]) }}
                        />
                      </div>
                    )}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-destructive hover:text-destructive"
                      disabled={cleanupLoading}
                      onClick={() => setCleanupOpen(true)}
                    >
                      <Trash2 className="size-4" />
                      {t("cleanupButton")}
                    </Button>
                  </DataTableToolbar>
                )}
              />
            </div>
          </TabsContent>

          {schedulesContent ? (
            <TabsContent value="schedules" className="min-h-0 flex-1 overflow-hidden pt-3">
              {schedulesContent}
            </TabsContent>
          ) : null}
        </Tabs>
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => {
        if (open) return
        setSelected(null)
        clearRequestedRun()
      }}>
        <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader><DialogTitle>{selected?.run.title}</DialogTitle><DialogDescription>{selected?.run.resource || selected?.run.task_type}</DialogDescription></DialogHeader>
          {selected ? <TaskDetails run={selected.run} events={selected.events} onAction={runAction} t={t} locale={i18n.language} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cleanupDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cleanupDialogDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label htmlFor="task-run-retention-days">{t("cleanupRetentionLabel")}</Label>
              <Input
                id="task-run-retention-days"
                type="number"
                min={1}
                max={3650}
                value={retentionDays}
                disabled={cleanupLoading}
                onChange={(event) => setRetentionDays(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">{t("cleanupRetentionHint")}</p>
            </div>
            <p className="border-l-2 border-border pl-3 text-sm text-muted-foreground">{t("cleanupDefaultPolicy")}</p>
            <p className="text-sm text-destructive">{t("cleanupWarning")}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanupLoading}>{t("cleanupCancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={cleanupLoading}
              onClick={(event) => {
                event.preventDefault()
                void cleanupRuns()
              }}
            >
              {cleanupLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("cleanupRunning")}
                </>
              ) : t("cleanupConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function TaskProgress({ run, t }: { run: TaskRun; t: TFunction }) {
  if (run.status === "succeeded") return <span className="text-xs text-muted-foreground">{t("completed")}</span>
  if (["failed", "canceled", "timeout"].includes(run.status)) return <span className="truncate text-xs text-muted-foreground">{run.error_message || t("ended")}</span>
  return <div className="flex items-center gap-2"><Progress value={run.progress} className="h-1.5" /><span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{run.progress}%</span></div>
}

function TaskStatusBadge({ status, t }: { status: TaskRunStatus; t: TFunction }) {
  const variants: Record<TaskRunStatus, "default" | "secondary" | "destructive" | "outline"> = { queued: "secondary", running: "default", succeeded: "outline", failed: "destructive", partial_success: "secondary", canceling: "secondary", canceled: "outline", timeout: "destructive" }
  return <Badge variant={variants[status]}>{t(statusLabelKeys[status])}</Badge>
}

function TaskDetails({ run, events, onAction, t, locale }: { run: TaskRun; events: TaskEvent[]; onAction: (action: "cancel" | "retry", run: TaskRun) => void; t: TFunction; locale: string }) {
  const formattedResult = formatTaskResult(run.result_json)
  return <div className="max-h-[calc(85vh-120px)] space-y-4 overflow-y-auto pr-2">
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-y py-3 text-sm sm:grid-cols-4">
      <Detail label={t("detailStatus")}><TaskStatusBadge status={run.status} t={t} /></Detail><Detail label={t("detailType")}>{taskTypeLabel(run.task_type, t)}</Detail>
      <Detail label={t("detailTrigger")}>{triggerTypeLabel(run.trigger_type, t)}</Detail><Detail label={t("detailProgress")}>{run.progress}%</Detail>
      <Detail label={t("detailSucceeded")}>{run.success_count}</Detail><Detail label={t("detailFailed")}>{run.failure_count}</Detail>
      <Detail label={t("detailStartedAt")}>{formatDate(run.started_at, locale)}</Detail><Detail label={t("detailFinishedAt")}>{formatDate(run.finished_at, locale)}</Detail>
      {run.attempt > 1 ? <Detail label={t("detailAttempt")}>{t("attemptValue", { count: run.attempt })}</Detail> : null}
    </div>
    {run.error_message ? <div className="border-l-2 border-destructive px-3 py-2 text-sm text-destructive">{run.error_message}</div> : null}
    <div><h3 className="mb-2 text-sm font-semibold">{t("eventsTitle")}</h3><ScrollArea className="h-64 border">
      {events.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">{t("eventsEmpty")}</div> : events.map((event) => (
        <div key={event.id} className="grid grid-cols-[130px_70px_minmax(0,1fr)] gap-2 border-b px-3 py-2 text-xs last:border-b-0">
          <span className="text-muted-foreground">{formatDate(event.created_at, locale)}</span><span className={event.level === "error" ? "text-destructive" : event.level === "warning" ? "text-amber-600" : "text-muted-foreground"}>{t(`eventLevel${event.level.charAt(0).toUpperCase()}${event.level.slice(1)}`)}</span><span>{event.message}</span>
        </div>
      ))}
    </ScrollArea></div>
    {formattedResult ? <div><h3 className="mb-2 text-sm font-semibold">{t("resultTitle")}</h3><ScrollArea className="h-64 border bg-muted/30">
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{formattedResult}</pre>
    </ScrollArea></div> : null}
    {(run.cancelable || run.retryable) ? <div className="flex justify-end gap-2">
      {run.cancelable && ["queued", "running"].includes(run.status) ? <Button variant="outline" size="sm" onClick={() => onAction("cancel", run)}><CircleStop className="size-4" />{t("cancelTask")}</Button> : null}
      {run.retryable && ["failed", "partial_success", "canceled", "timeout"].includes(run.status) ? <Button size="sm" onClick={() => onAction("retry", run)}><RotateCcw className="size-4" />{t("retryTask")}</Button> : null}
    </div> : null}
  </div>
}

function Detail({ label, children }: { label: string; children: ReactNode }) { return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 min-h-5">{children}</div></div> }

const statusLabelKeys: Record<TaskRunStatus, string> = {
  queued: "statusQueued", running: "statusRunning", succeeded: "statusSucceeded", failed: "statusFailed",
  partial_success: "statusPartial", canceling: "statusCanceling", canceled: "statusCanceled", timeout: "statusTimeout",
}

const taskTypeLabelKeys: Record<string, string> = {
  command: "typeCommand", script: "typeScript", batch: "typeBatch", file: "typeFile", sftp_upload: "typeSftpUpload",
  sftp_download: "typeSftpDownload", sftp_transfer: "typeSftpTransfer", sftp_recursive_delete: "typeSftpRecursiveDelete",
}

function taskTypeLabel(type: string, t: TFunction) { return taskTypeLabelKeys[type] ? t(taskTypeLabelKeys[type]) : type }
function triggerTypeLabel(type: TaskRun["trigger_type"], t: TFunction) {
  return t(({ manual: "triggerManual", scheduled: "triggerScheduled", system: "triggerSystem", api: "triggerApi" } as const)[type])
}
function formatTaskResult(value?: string) {
  if (!value) return ""
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
function formatDate(value: string | undefined, locale: string) { return value ? new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "-" }
