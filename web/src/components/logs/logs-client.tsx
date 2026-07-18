
import * as React from "react"
import type { ColumnDef, Row } from "@tanstack/react-table"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  KeyRound,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useAuthReady } from "@/hooks/use-auth-ready"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/sonner"
import { getErrorMessage } from "@/lib/error-utils"
import type { AuditLog, AuditLogCleanupResponse, AuditLogListParams } from "@/lib/log-types"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"
import {
  DashboardStatusLine,
  InlineStatusBadge,
  type DashboardTone,
} from "./log-dashboard-widgets"
import {
  LogDateRangeFilterButton,
  LogServerFilterButton,
  type ServerFilterOption,
} from "./log-server-filters"

interface LogsPageData {
  logs: AuditLog[]
  totalPages: number
  totalCount: number
  currentPage: number
  pageSize: number
}

interface LogsClientProps {
  initialData?: LogsPageData
  defaultAction?: string
  desktopMode?: boolean
  api: {
    list: (params?: AuditLogListParams) => Promise<{
      logs: AuditLog[]
      total: number
      page: number
      page_size: number
      total_pages: number
    }>
    cleanup: (retentionDays: number) => Promise<AuditLogCleanupResponse>
  }
}

type SortOrder = "asc" | "desc"

interface LogFilters {
  type: string[]
  category: string[]
  status: string[]
  source: string
  ip: string
  keyword: string
  start_date: string
  end_date: string
}

interface LogSortState {
  sort_by: string
  sort_order: SortOrder
}

const defaultFilters: LogFilters = {
  type: [],
  category: [],
  status: [],
  source: "",
  ip: "",
  keyword: "",
  start_date: "",
  end_date: "",
}

const defaultSort: LogSortState = {
  sort_by: "created_at",
  sort_order: "desc",
}

function formatTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

function formatDate(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

function formatDateTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatDuration(milliseconds?: number) {
  if (!milliseconds) return "-"
  if (milliseconds < 1000) return `${milliseconds}ms`
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function actionLabel(t: (key: string) => string, action: string) {
  const labels: Record<string, string> = {
    login: t("actionLogin"),
    logout: t("actionLogout"),
    ssh_connect: t("actionConnect"),
    ssh_disconnect: t("actionDisconnect"),
    sftp_upload: t("actionUpload"),
    sftp_download: t("actionDownload"),
    sftp_transfer: t("actionTransfer"),
    sftp_delete: t("actionDelete"),
    sftp_rename: t("actionRename"),
    sftp_mkdir: t("actionMkdir"),
    sftp_chmod: t("actionChmod"),
    monitoring_query: t("actionMonitoringQuery"),
    server_create: t("actionServerCreate"),
    server_update: t("actionServerUpdate"),
    server_delete: t("actionServerDelete"),
    server_test: t("actionServerTest"),
    user_create: t("actionUserCreate"),
    user_update: t("actionUserUpdate"),
    user_delete: t("actionUserDelete"),
    scheduled_task_create: t("actionScheduledTaskCreate"),
    scheduled_task_update: t("actionScheduledTaskUpdate"),
    scheduled_task_delete: t("actionScheduledTaskDelete"),
    scheduled_task_toggle: t("actionScheduledTaskToggle"),
    scheduled_task_trigger: t("actionScheduledTaskTrigger"),
    connect: t("actionConnect"),
    disconnect: t("actionDisconnect"),
    upload: t("actionUpload"),
    download: t("actionDownload"),
    delete: t("actionDelete"),
    create: t("actionCreate"),
    update: t("actionUpdate"),
  }
  return labels[action] || action
}

function actionTone(action: string): DashboardTone {
  if (action.includes("delete") || action.includes("failure")) return "rose"
  if (action.includes("upload") || action.includes("download") || action.includes("sftp")) return "blue"
  if (action.includes("server") || action.includes("ssh") || action.includes("connect")) return "emerald"
  if (action.includes("user")) return "violet"
  return "amber"
}

function statusTone(status: AuditLog["status"]): DashboardTone {
  if (status === "success") return "emerald"
  if (status === "running" || status === "pending") return "blue"
  if (status === "warning" || status === "partial" || status === "timeout") return "amber"
  return "rose"
}

function statusLabel(t: (key: string) => string, status: AuditLog["status"]) {
  if (status === "success") return t("filterStatusSuccessLabel")
  if (status === "warning") return t("filterStatusWarningLabel")
  if (status === "pending") return t("statusPending")
  if (status === "running") return t("statusRunning")
  if (status === "partial") return t("statusPartial")
  if (status === "canceled") return t("statusCanceled")
  if (status === "timeout") return t("statusTimeout")
  return t("filterStatusFailureLabel")
}

function typeLabel(t: (key: string) => string, type?: AuditLog["type"]) {
  if (type === "connection") return t("typeConnection")
  if (type === "transfer") return t("typeTransfer")
  if (type === "execution") return t("typeExecution")
  if (type === "audit") return t("typeAudit")
  return "-"
}

function categoryLabel(t: (key: string) => string, category?: AuditLog["category"]) {
  if (category === "activity") return t("categoryActivity")
  if (category === "audit") return t("categoryAudit")
  return "-"
}

function filtersToParams(filters: LogFilters): Pick<AuditLogListParams, "type" | "category" | "status" | "source" | "ip" | "keyword" | "start_date" | "end_date"> {
  return {
    type: filters.type.length > 0 ? filters.type as AuditLogListParams["type"] : undefined,
    category: filters.category.length > 0 ? filters.category as AuditLogListParams["category"] : undefined,
    status: filters.status.length > 0 ? filters.status : undefined,
    source: filters.source.trim() || undefined,
    ip: filters.ip.trim() || undefined,
    keyword: filters.keyword.trim() || undefined,
    start_date: filters.start_date || undefined,
    end_date: filters.end_date || undefined,
  }
}

function hasActiveFilters(filters: LogFilters) {
  return Object.entries(filters).some(([key, value]) => {
    if (key === "type" || key === "category" || key === "status") {
      return Array.isArray(value) && value.length > 0
    }
    return typeof value === "string" && value.trim() !== ""
  })
}

function exportLogs(logs: AuditLog[]) {
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `logs-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function LogsClient({ initialData, defaultAction, desktopMode = false, api }: LogsClientProps) {
  const { ready } = useAuthReady()
  const { t } = useTranslation("logsAudit")
  const [logs, setLogs] = React.useState<AuditLog[]>(initialData?.logs || [])
  const [initialLoading, setInitialLoading] = React.useState(!initialData)
  const [tableLoading, setTableLoading] = React.useState(false)
  const [page, setPage] = React.useState(initialData?.currentPage || 1)
  const [pageSize, setPageSize] = React.useState(initialData?.pageSize || 20)
  const [totalPages, setTotalPages] = React.useState(initialData?.totalPages || 1)
  const [totalRows, setTotalRows] = React.useState(initialData?.totalCount || 0)
  const [selectedLogId, setSelectedLogId] = React.useState<string | null>(null)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = React.useState(false)
  const [cleanupOpen, setCleanupOpen] = React.useState(false)
  const [cleanupLoading, setCleanupLoading] = React.useState(false)
  const [retentionDays, setRetentionDays] = React.useState("90")
  const [filters, setFilters] = React.useState<LogFilters>(defaultFilters)
  const [sort, setSort] = React.useState<LogSortState>(defaultSort)

  const loadLogs = React.useCallback(async (
    currentPage: number,
    currentPageSize: number,
    options: { showTableLoading?: boolean; filters?: LogFilters; sort?: LogSortState } = {},
  ) => {
    try {
      if (options.showTableLoading) setTableLoading(true)
      const filterParams = filtersToParams(options.filters ?? filters)
      const sortParams = options.sort ?? sort
      const logsResponse = await api.list({
        page: currentPage,
        page_size: currentPageSize,
        action: defaultAction,
        ...filterParams,
        ...sortParams,
      })
      setLogs(logsResponse.logs || [])
      setTotalPages(logsResponse.total_pages || 1)
      setTotalRows(logsResponse.total || 0)
      setSelectedLogId((current) => (
        current && logsResponse.logs?.some((log) => log.id === current)
          ? current
          : logsResponse.logs?.[0]?.id || null
      ))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("toastLoadFailed")))
    } finally {
      if (options.showTableLoading) setTableLoading(false)
    }
  }, [api, defaultAction, filters, sort, t])

  React.useEffect(() => {
    if (initialData || !ready) return
    const loadInitialData = async () => {
      try {
        setInitialLoading(true)
        await loadLogs(page, pageSize)
      } finally {
        setInitialLoading(false)
      }
    }
    void loadInitialData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initialData, defaultAction])

  const selectedLog = React.useMemo(
    () => logs.find((log) => log.id === selectedLogId) || logs[0] || null,
    [logs, selectedLogId]
  )

  const handleRefresh = () => {
    void loadLogs(page, pageSize, { showTableLoading: true })
  }

  const handleCleanupLogs = async () => {
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
      setPage(1)
      setSelectedLogId(null)
      setIsDetailDialogOpen(false)
      await loadLogs(1, pageSize, { showTableLoading: true })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("cleanupFailed")))
    } finally {
      setCleanupLoading(false)
    }
  }

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage)
    void loadLogs(nextPage, pageSize, { showTableLoading: true })
  }

  const handlePageSizeChange = (nextSize: number) => {
    setPageSize(nextSize)
    setPage(1)
    void loadLogs(1, nextSize, { showTableLoading: true })
  }

  const handleApplyFilters = () => {
    setPage(1)
    setSelectedLogId(null)
    setIsDetailDialogOpen(false)
    void loadLogs(1, pageSize, { showTableLoading: true })
  }

  const handleResetFilters = () => {
    const nextFilters = { ...defaultFilters }
    setFilters(nextFilters)
    setPage(1)
    setSelectedLogId(null)
    setIsDetailDialogOpen(false)
    void loadLogs(1, pageSize, { showTableLoading: true, filters: nextFilters })
  }

  const handleSort = React.useCallback((field: string) => {
    const nextSort: LogSortState = sort.sort_by === field
      ? { sort_by: field, sort_order: sort.sort_order === "asc" ? "desc" : "asc" }
      : { sort_by: field, sort_order: "desc" }
    setSort(nextSort)
    setPage(1)
    void loadLogs(1, pageSize, { showTableLoading: true, sort: nextSort })
  }, [loadLogs, pageSize, sort])

  const logColumns = React.useMemo<ColumnDef<AuditLog>[]>(() => {
    const meta = (m: DataTableColumnMeta): DataTableColumnMeta => m
    return [
    {
      id: "created_at",
      accessorKey: "created_at",
      size: 180,
      minSize: 150,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnTime")} field="created_at" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {formatTime(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "type",
      accessorKey: "type",
      size: 100,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnType")} field="type" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <InlineStatusBadge
          label={typeLabel(t, row.original.type)}
          tone={row.original.type === "audit" ? "amber" : actionTone(row.original.action)}
        />
      ),
    },
    {
      id: "category",
      accessorKey: "category",
      size: 110,
      minSize: 90,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnCategory")} field="category" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <InlineStatusBadge
          label={categoryLabel(t, row.original.category)}
          tone={row.original.category === "audit" ? "violet" : "emerald"}
        />
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      size: 120,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnStatus")} field="status" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <InlineStatusBadge
          label={statusLabel(t, row.original.status)}
          tone={statusTone(row.original.status)}
        />
      ),
      filterFn: (row: Row<AuditLog>, id: string, value: unknown) => {
        const selected = (value as string[]) || []
        if (selected.length === 0) return true
        return selected.includes(row.getValue(id) as string)
      },
    },
    {
      id: "action",
      accessorKey: "action",
      size: 140,
      minSize: 110,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnAction")} field="action" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <InlineStatusBadge
          label={actionLabel(t, row.original.action)}
          tone={actionTone(row.original.action)}
        />
      ),
    },
    {
      id: "username",
      accessorKey: "username",
      size: 120,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnUser")} field="username" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => row.original.username || "-",
    },
    {
      id: "resource",
      accessorKey: "resource",
      size: 180,
      minSize: 150,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnResource")} field="resource" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <span className="block w-full truncate" title={row.original.resource || undefined}>
          {row.original.resource || "-"}
        </span>
      ),
    },
    {
      id: "source",
      accessorKey: "source",
      size: 100,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnSource")} field="source" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {row.original.source || "-"}
        </span>
      ),
    },
    {
      id: "ip",
      accessorKey: "ip",
      size: 130,
      minSize: 110,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnIp")} field="ip" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {row.original.ip || "-"}
        </span>
      ),
    },
    {
      id: "duration",
      accessorKey: "duration",
      size: 100,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnDuration")} field="duration_ms" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLog> }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {formatDuration(row.original.duration)}
        </span>
      ),
    },
    {
      id: "details",
      accessorKey: "details",
      size: 260,
      minSize: 220,
      meta: meta({ align: "left" }),
      header: t("columnDetails"),
      cell: ({ row }: { row: Row<AuditLog> }) => {
        const details = row.original.details || row.original.error_msg || "-"
        return (
          <span className="block w-full truncate text-muted-foreground" title={details === "-" ? undefined : details}>
            {details}
          </span>
        )
      },
      filterFn: (row: Row<AuditLog>, _id: string, value: unknown) => {
        const keyword = String(value || "").trim().toLowerCase()
        if (!keyword) return true
        const log = row.original
        return [
          log.username,
          log.action,
          log.resource,
          log.ip,
          log.details,
          log.error_msg,
        ].some((item) => item?.toLowerCase().includes(keyword))
      },
    },
  ].filter((column) => (
    !desktopMode ||
    !["category", "username", "source", "ip"].includes(column.id ?? "")
  ))}, [desktopMode, handleSort, sort, t])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>{desktopMode ? t("desktopActivityDashboardDescription") : t("activityDashboardDescription")}</p>
        <DashboardStatusLine label={t("collectionHealthy")} timestamp={formatDateTime(new Date().toISOString())} />
      </div>

      <div className="min-h-[520px] flex-1">
        <DataTable
          data={logs}
          columns={logColumns}
          loading={initialLoading || tableLoading}
          currentPage={page}
          pageCount={totalPages}
          pageSize={pageSize}
          totalRows={totalRows}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          emptyMessage={t("emptyMessage")}
          className="min-h-[520px]"
          scrollContainerClassName="min-h-[360px]"
          density="compact"
          onRowClick={(log) => {
            setSelectedLogId(log.id)
            setIsDetailDialogOpen(true)
          }}
          getRowClassName={(log) => (
            selectedLog?.id === log.id ? "bg-emerald-500/5 hover:bg-emerald-500/10" : undefined
          )}
          toolbar={(table) => (
            <DataTableToolbar
              table={table}
              filterSlot={
                <LogFilterControls
                  filters={filters}
                  onFiltersChange={setFilters}
                  onApply={handleApplyFilters}
                  onReset={handleResetFilters}
                  hasActiveFilters={hasActiveFilters(filters)}
                  desktopMode={desktopMode}
                  t={t}
                />
              }
              showRefresh
              onRefresh={handleRefresh}
              isRefreshing={tableLoading}
            >
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-destructive hover:text-destructive"
                disabled={cleanupLoading}
                onClick={() => setCleanupOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("cleanupButton")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportLogs(table.getFilteredRowModel().rows.map((row) => row.original))} className="h-8">
                <Download className="mr-2 h-4 w-4" />
                {t("exportLogs")}
              </Button>
            </DataTableToolbar>
          )}
        />
      </div>

      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
          <DialogHeader className="shrink-0 pr-8">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{t("logDetailsTitle")}</DialogTitle>
              {selectedLog && <InlineStatusBadge label={actionLabel(t, selectedLog.action)} tone={actionTone(selectedLog.action)} />}
              {selectedLog && <span className="font-mono text-xs text-muted-foreground">ID: {selectedLog.id}</span>}
            </div>
            <DialogDescription>{selectedLog?.resource || selectedLog?.source || t("emptyMessage")}</DialogDescription>
          </DialogHeader>
          {selectedLog ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2 scrollbar-custom">
              <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Detail label={t("columnTime")} value={`${formatDate(selectedLog.created_at)} ${formatTime(selectedLog.created_at)}`} />
                <Detail label={t("columnResource")} value={selectedLog.resource || "-"} />
                <Detail label={t("columnStatus")} value={statusLabel(t, selectedLog.status)} />
                <Detail label={t("columnDuration")} value={formatDuration(selectedLog.duration)} />
                <Detail label={t("columnAction")} value={actionLabel(t, selectedLog.action)} />
                <Detail label={t("columnServer")} value={selectedLog.server_id || "-"} />
                {!desktopMode ? (
                  <>
                    <Detail label={t("columnUser")} value={selectedLog.username || "-"} />
                    <Detail label={t("columnIp")} value={selectedLog.ip || "-"} />
                    <Detail label={t("columnCategory")} value={categoryLabel(t, selectedLog.category)} />
                  </>
                ) : null}
              </div>
              <div className="rounded-lg border bg-muted/25 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  {t("detailPayloadTitle")}
                </div>
                <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-3 font-mono text-xs text-muted-foreground">
                  {selectedLog.details || selectedLog.error_msg || selectedLog.user_agent || "-"}
                </pre>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("emptyMessage")}</div>
          )}
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
              <Label htmlFor="activity-log-retention-days">{t("cleanupRetentionLabel")}</Label>
              <Input
                id="activity-log-retention-days"
                type="number"
                min={1}
                max={3650}
                value={retentionDays}
                disabled={cleanupLoading}
                onChange={(event) => setRetentionDays(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">{t("cleanupRetentionHint")}</p>
            </div>
            <p className="text-sm text-destructive">{t("cleanupWarning")}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanupLoading}>{t("cleanupCancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={cleanupLoading}
              onClick={(event) => {
                event.preventDefault()
                void handleCleanupLogs()
              }}
            >
              {cleanupLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("cleanupRunning")}
                </>
              ) : t("cleanupConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SortableHeader({
  label,
  field,
  sort,
  onSort,
}: {
  label: string
  field: string
  sort: LogSortState
  onSort: (field: string) => void
}) {
  const active = sort.sort_by === field
  const Icon = active ? (sort.sort_order === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 -translate-x-2 px-2 text-xs font-medium"
      onClick={() => onSort(field)}
    >
      <span>{label}</span>
      <Icon className="ml-1.5 h-3.5 w-3.5" />
    </Button>
  )
}

function LogFilterControls({
  filters,
  onFiltersChange,
  onApply,
  onReset,
  hasActiveFilters,
  desktopMode,
  t,
}: {
  filters: LogFilters
  onFiltersChange: React.Dispatch<React.SetStateAction<LogFilters>>
  onApply: () => void
  onReset: () => void
  hasActiveFilters: boolean
  desktopMode?: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const updateFilter = <K extends keyof LogFilters>(key: K, value: LogFilters[K]) => {
    onFiltersChange((current) => ({ ...current, [key]: value }))
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Enter") {
      onApply()
    }
  }

  const typeOptions = React.useMemo<ServerFilterOption[]>(() => {
    const options: ServerFilterOption[] = [
      { label: t("typeConnection"), value: "connection" },
      { label: t("typeTransfer"), value: "transfer" },
      { label: t("typeExecution"), value: "execution" },
    ]
    return desktopMode ? options : [...options, { label: t("typeAudit"), value: "audit" }]
  }, [desktopMode, t])

  const categoryOptions = React.useMemo<ServerFilterOption[]>(() => [
    { label: t("categoryActivity"), value: "activity" },
    { label: t("categoryAudit"), value: "audit" },
  ], [t])

  const statusOptions = React.useMemo<ServerFilterOption[]>(() => [
    { label: t("statusPending"), value: "pending" },
    { label: t("statusRunning"), value: "running" },
    { label: t("filterStatusSuccessLabel"), value: "success" },
    { label: t("filterStatusFailureLabel"), value: "failure" },
    { label: t("statusPartial"), value: "partial" },
    { label: t("statusCanceled"), value: "canceled" },
    { label: t("statusTimeout"), value: "timeout" },
    { label: t("filterStatusWarningLabel"), value: "warning" },
  ], [t])

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Input
        value={filters.keyword}
        placeholder={t("filterKeywordPlaceholder")}
        onChange={(event) => updateFilter("keyword", event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-8 w-full min-w-[180px] sm:w-[220px]"
      />
      <LogServerFilterButton
        title={t("filterTypeTitle")}
        values={filters.type}
        options={typeOptions}
        selectedLabel={(count) => t("filterSelectedCount", { count })}
        clearLabel={t("clearServerFilters")}
        emptyLabel={t("filterEmpty")}
        onValuesChange={(values) => updateFilter("type", values)}
      />
      {!desktopMode ? (
        <LogServerFilterButton
          title={t("filterCategoryTitle")}
          values={filters.category}
          options={categoryOptions}
          selectedLabel={(count) => t("filterSelectedCount", { count })}
          clearLabel={t("clearServerFilters")}
          emptyLabel={t("filterEmpty")}
          onValuesChange={(values) => updateFilter("category", values)}
        />
      ) : null}
      <LogServerFilterButton
        title={t("filterStatusTitle")}
        values={filters.status}
        options={statusOptions}
        selectedLabel={(count) => t("filterSelectedCount", { count })}
        clearLabel={t("clearServerFilters")}
        emptyLabel={t("filterEmpty")}
        onValuesChange={(values) => updateFilter("status", values)}
      />
      {!desktopMode ? (
        <>
          <Input
            value={filters.source}
            placeholder={t("filterSourcePlaceholder")}
            onChange={(event) => updateFilter("source", event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 w-full min-w-[120px] sm:w-[150px]"
          />
          <Input
            value={filters.ip}
            placeholder={t("filterIpPlaceholder")}
            onChange={(event) => updateFilter("ip", event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 w-full min-w-[120px] sm:w-[150px]"
          />
        </>
      ) : null}
      <LogDateRangeFilterButton
        title={t("filterDateRange")}
        startValue={filters.start_date}
        endValue={filters.end_date}
        onRangeChange={(range) => {
          onFiltersChange((current) => ({
            ...current,
            start_date: range.start,
            end_date: range.end,
          }))
        }}
        clearLabel={t("clearServerFilters")}
        todayLabel={t("filterToday")}
      />
      <Button type="button" size="sm" className="h-8" onClick={onApply}>
        <Search className="mr-2 h-4 w-4" />
        {t("applyFilters")}
      </Button>
      {hasActiveFilters ? (
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onReset}>
          <X className="mr-2 h-4 w-4" />
          {t("clearServerFilters")}
        </Button>
      ) : null}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  )
}
