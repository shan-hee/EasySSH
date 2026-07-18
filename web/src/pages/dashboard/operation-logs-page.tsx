import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileText,
  History,
  Rocket,
  Search,
  Upload,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { toast } from "@/components/ui/sonner"
import { getErrorMessage } from "@/lib/error-utils"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"
import {
  operationRecordsApi,
  type OperationRecord,
  type OperationRecordCategory,
  type OperationRecordListParams,
  type OperationRecordStatus,
  type OperationRecordType,
} from "@/lib/api/operation-records"
import { useAuthReady } from "@/hooks/use-auth-ready"
import {
  DashboardStatusLine,
  InlineStatusBadge,
  type DashboardTone,
} from "@/components/logs/log-dashboard-widgets"
import {
  LogDateRangeFilterButton,
  LogServerFilterButton,
  type ServerFilterOption,
} from "@/components/logs/log-server-filters"

type SortOrder = "asc" | "desc"

interface OperationRecordFilters {
  type: string[]
  category: string[]
  status: string[]
  source: string
  ip: string
  keyword: string
  start_date: string
  end_date: string
}

interface OperationRecordSortState {
  sort_by: string
  sort_order: SortOrder
}

const defaultSort: OperationRecordSortState = {
  sort_by: "created_at",
  sort_order: "desc",
}

function createDefaultFilters(type?: OperationRecordType): OperationRecordFilters {
  return {
    type: type ? [type] : [],
    category: [],
    status: [],
    source: "",
    ip: "",
    keyword: "",
    start_date: "",
    end_date: "",
  }
}

function isOperationRecordType(value: string | null): value is OperationRecordType {
  return value === "connection" || value === "transfer" || value === "execution" || value === "audit"
}

function formatTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

function formatDateTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatDuration(milliseconds: number) {
  if (!milliseconds) return "-"
  if (milliseconds < 1000) return `${milliseconds}ms`
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatBytes(bytes: number) {
  if (!bytes) return "-"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

function statusTone(status: OperationRecordStatus): DashboardTone {
  if (status === "success") return "emerald"
  if (status === "running" || status === "pending") return "blue"
  if (status === "partial" || status === "timeout" || status === "warning") return "amber"
  return "rose"
}

function typeTone(type: OperationRecordType): DashboardTone {
  if (type === "connection") return "emerald"
  if (type === "transfer") return "violet"
  if (type === "audit") return "blue"
  return "amber"
}

function typeIcon(type: OperationRecordType) {
  if (type === "connection") return History
  if (type === "transfer") return Upload
  if (type === "audit") return FileText
  return Rocket
}

function categoryTone(category: OperationRecordCategory): DashboardTone {
  return category === "audit" ? "violet" : "emerald"
}

function actionLabel(t: (key: string) => string, action: string) {
  const labels: Record<string, string> = {
    login: t("actionLogin"),
    logout: t("actionLogout"),
    ssh_connect: t("actionConnect"),
    ssh_disconnect: t("actionDisconnect"),
    ssh_session: t("actionSshSession"),
    sftp_upload: t("actionUpload"),
    sftp_download: t("actionDownload"),
    sftp_transfer: t("actionTransfer"),
    sftp_delete: t("actionDelete"),
    sftp_rename: t("actionRename"),
    sftp_mkdir: t("actionMkdir"),
    sftp_chmod: t("actionChmod"),
    upload: t("actionUpload"),
    download: t("actionDownload"),
    batch_download: t("actionBatchDownload"),
    transfer: t("actionTransfer"),
    monitoring_query: t("actionMonitoringQuery"),
    task_execute: t("actionTaskExecute"),
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
    create: t("actionCreate"),
    update: t("actionUpdate"),
    delete: t("actionDelete"),
  }
  return labels[action] || action
}

function exportRecords(records: OperationRecord[]) {
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `operation-records-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function filtersToParams(filters: OperationRecordFilters): Pick<OperationRecordListParams, "type" | "category" | "status" | "source" | "ip" | "keyword" | "start_date" | "end_date"> {
  return {
    type: filters.type.length > 0 ? filters.type as OperationRecordType[] : undefined,
    category: filters.category.length > 0 ? filters.category as OperationRecordCategory[] : undefined,
    status: filters.status.length > 0 ? filters.status as OperationRecordStatus[] : undefined,
    source: filters.source.trim() || undefined,
    ip: filters.ip.trim() || undefined,
    keyword: filters.keyword.trim() || undefined,
    start_date: filters.start_date || undefined,
    end_date: filters.end_date || undefined,
  }
}

function hasActiveFilters(filters: OperationRecordFilters) {
  return Object.entries(filters).some(([key, value]) => {
    if (key === "type" || key === "category" || key === "status") {
      return Array.isArray(value) && value.length > 0
    }
    return typeof value === "string" && value.trim() !== ""
  })
}

export default function OperationLogsPage() {
  const { t } = useTranslation("operationLogs")

  return (
    <>
      <PageHeader title={t("pageTitle")} />
      <React.Suspense fallback={<div className="flex min-h-0 flex-1" />}>
        <OperationLogsContent />
      </React.Suspense>
    </>
  )
}

function OperationLogsContent() {
  const { t } = useTranslation("operationLogs")
  const [searchParams] = useSearchParams()
  const { ready } = useAuthReady()
  const typeParam = searchParams.get("type")
  const initialType = isOperationRecordType(typeParam) ? typeParam : undefined
  const previousTypeParamRef = React.useRef<OperationRecordType | undefined>(initialType)
  const [filters, setFilters] = React.useState<OperationRecordFilters>(() => createDefaultFilters(initialType))
  const [sort, setSort] = React.useState<OperationRecordSortState>(defaultSort)
  const [records, setRecords] = React.useState<OperationRecord[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalRows, setTotalRows] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = React.useState(false)

  const typeLabels = React.useMemo<Record<OperationRecordType, string>>(() => ({
    connection: t("typeConnection"),
    transfer: t("typeTransfer"),
    execution: t("typeExecution"),
    audit: t("typeAudit"),
  }), [t])

  const categoryLabels = React.useMemo<Record<OperationRecordCategory, string>>(() => ({
    activity: t("categoryActivity"),
    audit: t("categoryAudit"),
  }), [t])

  const statusLabels = React.useMemo<Record<string, string>>(() => ({
    pending: t("statusPending"),
    running: t("statusRunning"),
    success: t("statusSuccess"),
    failure: t("statusFailure"),
    partial: t("statusPartial"),
    canceled: t("statusCanceled"),
    timeout: t("statusTimeout"),
    warning: t("statusWarning"),
  }), [t])

  const loadData = React.useCallback(async (
    nextPage = page,
    showRefresh = false,
    nextFilters: OperationRecordFilters = filters,
    nextPageSize = pageSize,
    nextSort: OperationRecordSortState = sort,
  ) => {
    try {
      if (showRefresh) setRefreshing(true)
      else setLoading(true)

      const filterParams = filtersToParams(nextFilters)
      const list = await operationRecordsApi.list({
        page: nextPage,
        page_size: nextPageSize,
        ...filterParams,
        ...nextSort,
      })
      setRecords(list.records || [])
      setPage(list.page || nextPage)
      setTotalPages(list.total_pages || 1)
      setTotalRows(list.total || 0)
      setSelectedId((current) => (
        current && list.records?.some((record) => record.id === current)
          ? current
          : list.records?.[0]?.id || null
      ))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("loadFailed")))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [filters, page, pageSize, sort, t])

  React.useEffect(() => {
    if (!ready) return
    void loadData(1, false, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  React.useEffect(() => {
    if (previousTypeParamRef.current === initialType) return
    previousTypeParamRef.current = initialType
    const nextFilters = { ...filters, type: initialType ? [initialType] : [] }
    setFilters(nextFilters)
    setPage(1)
    setSelectedId(null)
    if (ready) {
      void loadData(1, true, nextFilters)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialType])

  const selectedRecord = React.useMemo(
    () => records.find((record) => record.id === selectedId) || records[0] || null,
    [records, selectedId]
  )

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage)
    void loadData(nextPage, true, filters, pageSize)
  }

  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize)
    setPage(1)
    void loadData(1, true, filters, nextPageSize)
  }

  const handleRefresh = () => {
    void loadData(page, true, filters, pageSize)
  }

  const handleApplyFilters = () => {
    setPage(1)
    setSelectedId(null)
    setIsDetailDialogOpen(false)
    void loadData(1, true, filters, pageSize)
  }

  const handleResetFilters = () => {
    const nextFilters = createDefaultFilters(initialType)
    setFilters(nextFilters)
    setPage(1)
    setSelectedId(null)
    setIsDetailDialogOpen(false)
    void loadData(1, true, nextFilters, pageSize)
  }

  const handleSort = React.useCallback((field: string) => {
    const nextSort: OperationRecordSortState = sort.sort_by === field
      ? { sort_by: field, sort_order: sort.sort_order === "asc" ? "desc" : "asc" }
      : { sort_by: field, sort_order: "desc" }
    setSort(nextSort)
    setPage(1)
    void loadData(1, true, filters, pageSize, nextSort)
  }, [filters, loadData, pageSize, sort])

  const recordColumns = React.useMemo<ColumnDef<OperationRecord>[]>(() => {
    const meta = (m: DataTableColumnMeta): DataTableColumnMeta => m
    return [
    {
      id: "started_at",
      accessorFn: (record) => record.started_at || record.created_at,
      size: 180,
      minSize: 150,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnTime")} field="created_at" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {formatTime(row.original.started_at || row.original.created_at)}
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
      cell: ({ row }) => (
        <InlineStatusBadge label={typeLabels[row.original.type]} tone={typeTone(row.original.type)} />
      ),
    },
    {
      id: "category",
      accessorKey: "category",
      size: 110,
      minSize: 90,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnCategory")} field="category" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge label={categoryLabels[row.original.category]} tone={categoryTone(row.original.category)} />
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      size: 120,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnStatus")} field="status" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge label={statusLabels[row.original.status] || row.original.status} tone={statusTone(row.original.status)} />
      ),
    },
    {
      id: "action",
      accessorKey: "action",
      size: 240,
      minSize: 200,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnAction")} field="action" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => {
        const record = row.original
        const TypeIcon = typeIcon(record.type)
        const readableAction = actionLabel(t, record.action)
        return (
          <div className="flex w-full min-w-0 items-center gap-2">
            <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate font-medium">{record.title || readableAction}</div>
              <div className="truncate text-xs text-muted-foreground">{record.resource || record.source || "-"}</div>
            </div>
          </div>
        )
      },
    },
    {
      id: "username",
      accessorKey: "username",
      size: 120,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnUser")} field="username" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => row.original.username || "-",
    },
    {
      id: "server_name",
      accessorKey: "server_name",
      size: 160,
      minSize: 130,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnServer")} field="server_name" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="block w-full truncate" title={row.original.server_name || undefined}>
          {row.original.server_name || "-"}
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
      cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{row.original.source || "-"}</span>,
    },
    {
      id: "ip",
      accessorKey: "ip",
      size: 130,
      minSize: 110,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnIp")} field="ip" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs">{row.original.ip || "-"}</span>,
    },
    {
      id: "progress",
      accessorKey: "progress",
      size: 130,
      minSize: 110,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnProgress")} field="progress" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        row.original.progress > 0 ? (
          <div className="flex w-full items-center gap-2">
            <Progress
              value={row.original.progress}
              className="h-1.5"
              indicatorClassName={row.original.status === "failure" ? "bg-rose-500" : undefined}
            />
            <span className="w-9 text-xs tabular-nums">{row.original.progress}%</span>
          </div>
        ) : "-"
      ),
    },
    {
      id: "duration_ms",
      accessorKey: "duration_ms",
      size: 100,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <SortableHeader label={t("columnDuration")} field="duration_ms" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => formatDuration(row.original.duration_ms),
    },
    {
      id: "result",
      accessorFn: (record) => record.error_message || record.detail_json || "",
      size: 260,
      minSize: 220,
      meta: meta({ align: "left" }),
      header: t("columnResult"),
      cell: ({ row }) => {
        const result = row.original.error_message || row.original.detail_json || row.original.source || "-"
        return (
          <span className="block w-full truncate text-muted-foreground" title={result === "-" ? undefined : result}>
            {result}
          </span>
        )
      },
    },
  ]}, [categoryLabels, handleSort, sort, statusLabels, t, typeLabels])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>{t("dashboardDescription")}</p>
        <DashboardStatusLine label={t("systemHealthy")} timestamp={formatDateTime(new Date().toISOString())} />
      </div>

      <div className="min-h-[520px] flex-1">
        <DataTable
          data={records}
          columns={recordColumns}
          loading={loading || refreshing}
          currentPage={page}
          pageCount={totalPages}
          pageSize={pageSize}
          totalRows={totalRows}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          emptyMessage={t("empty")}
          className="min-h-[520px]"
          scrollContainerClassName="min-h-[360px]"
          density="compact"
          onRowClick={(record) => {
            setSelectedId(record.id)
            setIsDetailDialogOpen(true)
          }}
          getRowClassName={(record) => (
            selectedRecord?.id === record.id ? "bg-emerald-500/5 hover:bg-emerald-500/10" : undefined
          )}
          toolbar={(table) => (
            <DataTableToolbar
              table={table}
              filterSlot={
                <OperationRecordFilterControls
                  filters={filters}
                  onFiltersChange={setFilters}
                  onApply={handleApplyFilters}
                  onReset={handleResetFilters}
                  hasActiveFilters={hasActiveFilters(filters)}
                  t={t}
                />
              }
              showRefresh
              onRefresh={handleRefresh}
              isRefreshing={refreshing}
            >
              <Button variant="outline" size="sm" onClick={() => exportRecords(table.getFilteredRowModel().rows.map((row) => row.original))} className="h-8">
                <Download className="mr-2 h-4 w-4" />
                {t("exportRecords")}
              </Button>
            </DataTableToolbar>
          )}
        />
      </div>

      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
          <DialogHeader className="shrink-0 pr-8">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{t("detailTitle")}</DialogTitle>
              {selectedRecord && <InlineStatusBadge label={typeLabels[selectedRecord.type]} tone={typeTone(selectedRecord.type)} />}
              {selectedRecord && <span className="font-mono text-xs text-muted-foreground">ID: {selectedRecord.id}</span>}
            </div>
            <DialogDescription>
              {selectedRecord ? selectedRecord.title || actionLabel(t, selectedRecord.action) : t("empty")}
            </DialogDescription>
          </DialogHeader>
          {selectedRecord ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2 scrollbar-custom">
              <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Detail label={t("columnType")} value={typeLabels[selectedRecord.type]} />
                <Detail label={t("columnCategory")} value={categoryLabels[selectedRecord.category]} />
                <Detail label={t("columnStatus")} value={statusLabels[selectedRecord.status] || selectedRecord.status} />
                <Detail label={t("columnAction")} value={actionLabel(t, selectedRecord.action)} />
                <Detail label={t("columnUser")} value={selectedRecord.username || "-"} />
                <Detail label={t("columnServer")} value={selectedRecord.server_name || "-"} />
                <Detail label={t("columnSource")} value={selectedRecord.source || "-"} />
                <Detail label={t("columnIp")} value={selectedRecord.ip || "-"} />
                <Detail label={t("columnDuration")} value={formatDuration(selectedRecord.duration_ms)} />
                <Detail label={t("detailStartedAt")} value={formatDateTime(selectedRecord.started_at || selectedRecord.created_at)} />
                <Detail label={t("detailFinishedAt")} value={formatDateTime(selectedRecord.finished_at)} />
                <Detail label={t("detailTraffic")} value={`${formatBytes(selectedRecord.bytes_processed)} / ${formatBytes(selectedRecord.bytes_total)}`} />
              </div>
              <div className="rounded-lg border bg-muted/25 p-4">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
                  <span>{t("detailPreviewTitle")}</span>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigator.clipboard?.writeText(selectedRecord.detail_json || selectedRecord.error_message || "")}>
                    {t("copy")}
                  </Button>
                </div>
                <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-3 font-mono text-xs text-muted-foreground">
                  {selectedRecord.detail_json || selectedRecord.error_message || selectedRecord.resource || selectedRecord.user_agent || "-"}
                </pre>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</div>
          )}
        </DialogContent>
      </Dialog>
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
  sort: OperationRecordSortState
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

function OperationRecordFilterControls({
  filters,
  onFiltersChange,
  onApply,
  onReset,
  hasActiveFilters,
  t,
}: {
  filters: OperationRecordFilters
  onFiltersChange: React.Dispatch<React.SetStateAction<OperationRecordFilters>>
  onApply: () => void
  onReset: () => void
  hasActiveFilters: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const updateFilter = <K extends keyof OperationRecordFilters>(key: K, value: OperationRecordFilters[K]) => {
    onFiltersChange((current) => ({ ...current, [key]: value }))
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Enter") {
      onApply()
    }
  }

  const typeOptions = React.useMemo<ServerFilterOption[]>(() => [
    { label: t("typeConnection"), value: "connection" },
    { label: t("typeTransfer"), value: "transfer" },
    { label: t("typeExecution"), value: "execution" },
    { label: t("typeAudit"), value: "audit" },
  ], [t])

  const categoryOptions = React.useMemo<ServerFilterOption[]>(() => [
    { label: t("categoryActivity"), value: "activity" },
    { label: t("categoryAudit"), value: "audit" },
  ], [t])

  const statusOptions = React.useMemo<ServerFilterOption[]>(() => [
    { label: t("statusPending"), value: "pending" },
    { label: t("statusRunning"), value: "running" },
    { label: t("statusSuccess"), value: "success" },
    { label: t("statusFailure"), value: "failure" },
    { label: t("statusPartial"), value: "partial" },
    { label: t("statusCanceled"), value: "canceled" },
    { label: t("statusTimeout"), value: "timeout" },
    { label: t("statusWarning"), value: "warning" },
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
      <LogServerFilterButton
        title={t("filterCategoryTitle")}
        values={filters.category}
        options={categoryOptions}
        selectedLabel={(count) => t("filterSelectedCount", { count })}
        clearLabel={t("clearServerFilters")}
        emptyLabel={t("filterEmpty")}
        onValuesChange={(values) => updateFilter("category", values)}
      />
      <LogServerFilterButton
        title={t("filterStatusTitle")}
        values={filters.status}
        options={statusOptions}
        selectedLabel={(count) => t("filterSelectedCount", { count })}
        clearLabel={t("clearServerFilters")}
        emptyLabel={t("filterEmpty")}
        onValuesChange={(values) => updateFilter("status", values)}
      />
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
