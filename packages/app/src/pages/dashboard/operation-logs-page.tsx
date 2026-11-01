import { ActivityLinks } from "@/components/activity/activity-links"
import { ActivityOverview } from "@/components/activity/activity-overview"
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Download,
  FileText,
  History,
  Rocket,
  Upload,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { CopyCheckIcon } from "@/components/animate-ui/icons/copy-check"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/sonner"
import { getErrorMessage } from "@/lib/error-utils"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"
import {
  operationRecordsApi,
  type OperationRecordCategory,
  type OperationRecordListParams,
  type OperationRecordStatus,
  type OperationRecordSummary,
  type OperationRecordType,
} from "@/lib/api/operation-records"
import { serversApi } from "@/lib/api/servers"
import { useAuthReady } from "@/hooks/use-auth-ready"
import {
  InlineStatusBadge,
  type DashboardTone,
} from "@/components/logs/log-dashboard-widgets"
import {
  LogFilterBar,
  createLogFilters,
  hasActiveLogFilters,
  useLogServerOptions,
  type LogFilterValues,
  type ServerFilterOption,
} from "@/components/logs/log-server-filters"
import {
  LogDetailItem,
  LogFilesCell,
  LogProgressCell,
  LogSortHeader,
  LogStatusCell,
  LogTableSummary,
  defaultLogSort,
  downloadLogsJson,
  formatLogBytes,
  formatLogDuration,
  formatLogTime,
  nextLogSort,
  type LogSortState,
} from "@/components/logs/log-table-parts"
import { operationRecordsQueryOptions } from "@/lib/dashboard-query-options"
import { queryKeys } from "@/lib/query-keys"
import { operationRecordDetailPreview } from "@/pages/dashboard/operation-record-utils"
import { PageLoading } from "@/components/page-loading"

function createDefaultFilters(type?: OperationRecordType): LogFilterValues {
  return createLogFilters(type ? [type] : [])
}

function isOperationRecordType(value: string | null): value is OperationRecordType {
  return value === "connection" || value === "transfer" || value === "execution" || value === "audit"
}

function formatDateTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
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
    server_reorder: t("actionServerReorder"),
    user_create: t("actionUserCreate"),
    user_update: t("actionUserUpdate"),
    user_delete: t("actionUserDelete"),
    scheduled_task_create: t("actionScheduledTaskCreate"),
    scheduled_task_update: t("actionScheduledTaskUpdate"),
    scheduled_task_delete: t("actionScheduledTaskDelete"),
    scheduled_task_toggle: t("actionScheduledTaskToggle"),
    scheduled_task_trigger: t("actionScheduledTaskTrigger"),
    profile_update: t("actionProfileUpdate"),
    security_update: t("actionSecurityUpdate"),
    role_create: t("actionRoleCreate"),
    role_update: t("actionRoleUpdate"),
    role_delete: t("actionRoleDelete"),
    resource_grant: t("actionResourceGrant"),
    resource_revoke: t("actionResourceRevoke"),
    script_create: t("actionScriptCreate"),
    script_update: t("actionScriptUpdate"),
    script_delete: t("actionScriptDelete"),
    script_execute: t("actionScriptExecute"),
    system_settings_update: t("actionSystemSettingsUpdate"),
    security_settings_update: t("actionSecuritySettingsUpdate"),
    notification_settings_update: t("actionNotificationSettingsUpdate"),
    ai_config_update: t("actionAIConfigUpdate"),
    create: t("actionCreate"),
    update: t("actionUpdate"),
    delete: t("actionDelete"),
  }
  return labels[action] || action
}

function filtersToParams(filters: LogFilterValues): Pick<OperationRecordListParams, "type" | "category" | "status" | "server_id" | "source" | "ip" | "keyword" | "start_date" | "end_date"> {
  return {
    server_id: filters.server_id || undefined,
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

export default function OperationLogsPage() {
  const { t } = useTranslation("operationLogs")

  return (
    <>
      <PageHeader title={t("pageTitle")} />
      <OperationLogsContent />
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
  const [filters, setFilters] = React.useState<LogFilterValues>(() => createDefaultFilters(initialType))
  const [appliedFilters, setAppliedFilters] = React.useState<LogFilterValues>(() => createDefaultFilters(initialType))
  const [sort, setSort] = React.useState<LogSortState>(defaultLogSort)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const copyResetTimerRef = React.useRef<number | null>(null)

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
    unknown: t("statusUnknown"),
  }), [t])

  const serverOptions = useLogServerOptions(serversApi, ready)
  const filteredServer = React.useMemo(() => {
    const id = appliedFilters.server_id
    if (!id) return null
    return { id, name: serverOptions.find((option) => option.value === id)?.label ?? id }
  }, [appliedFilters.server_id, serverOptions])

  const queryParams = React.useMemo<OperationRecordListParams>(() => ({
    page,
    page_size: pageSize,
    ...filtersToParams(appliedFilters),
    ...sort,
  }), [appliedFilters, page, pageSize, sort])
  const recordsQuery = useQuery({
    ...operationRecordsQueryOptions(queryParams),
    enabled: ready,
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.records.some((record) => record.status === "pending" || record.status === "running")
        ? 3_000
        : 60_000
    },
  })
  const detailQuery = useQuery({
    queryKey: queryKeys.logs.operationDetail(selectedId ?? "none"),
    queryFn: () => operationRecordsApi.getById(selectedId as string),
    enabled: ready && isDetailDialogOpen && selectedId !== null,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "pending" || status === "running" ? 3_000 : false
    },
  })
  const records = React.useMemo(
    () => recordsQuery.data?.records ?? [],
    [recordsQuery.data?.records],
  )
  const totalPages = Math.max(1, recordsQuery.data?.total_pages ?? 1)
  const totalRows = recordsQuery.data?.total ?? 0
  const loading = recordsQuery.isPending
  const refreshing = recordsQuery.isFetching && !recordsQuery.isPending

  React.useEffect(() => {
    if (!recordsQuery.error) return
    toast.error(getErrorMessage(recordsQuery.error, t("loadFailed")))
  }, [recordsQuery.error, t])

  React.useEffect(() => {
    if (!detailQuery.error || detailQuery.data) return
    toast.error(getErrorMessage(detailQuery.error, t("detailLoadFailed")))
  }, [detailQuery.data, detailQuery.error, t])

  React.useEffect(() => {
    if (page > totalPages && !recordsQuery.isPlaceholderData) setPage(totalPages)
  }, [page, recordsQuery.isPlaceholderData, totalPages])

  React.useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
  }, [])

  React.useEffect(() => {
    if (previousTypeParamRef.current === initialType) return
    previousTypeParamRef.current = initialType
    const type = initialType ? [initialType] : []
    setFilters((current) => ({ ...current, type }))
    setAppliedFilters((current) => ({ ...current, type }))
    setPage(1)
    setSelectedId(null)
    setIsDetailDialogOpen(false)
  }, [initialType])

  const selectedSummary = React.useMemo(
    () => records.find((record) => record.id === selectedId) || null,
    [records, selectedId]
  )
  const selectedRecord = detailQuery.data ?? selectedSummary
  const detailPreviewValue = operationRecordDetailPreview(selectedRecord)

  const handleCopyDetail = React.useCallback(async () => {
    if (!detailPreviewValue || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(detailPreviewValue)
      setCopied(true)
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        copyResetTimerRef.current = null
      }, 2_000)
    } catch (error) {
      toast.error(getErrorMessage(error, t("copyFailed")))
    }
  }, [detailPreviewValue, t])

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage)
  }

  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize)
    setPage(1)
  }

  const handleRefresh = () => {
    void recordsQuery.refetch()
    if (isDetailDialogOpen && selectedId) void detailQuery.refetch()
  }

  const handleApplyFilters = () => {
    setPage(1)
    setSelectedId(null)
    setIsDetailDialogOpen(false)
    setAppliedFilters(filters)
  }

  const handleResetFilters = () => {
    const nextFilters = createDefaultFilters(initialType)
    setFilters(nextFilters)
    setAppliedFilters(nextFilters)
    setPage(1)
    setSelectedId(null)
    setIsDetailDialogOpen(false)
  }

  const handleSort = React.useCallback((field: string) => {
    setSort(nextLogSort(sort, field))
    setPage(1)
  }, [sort])

  const recordColumns = React.useMemo<ColumnDef<OperationRecordSummary>[]>(() => {
    const meta = (m: DataTableColumnMeta): DataTableColumnMeta => m
    return [
    {
      id: "started_at",
      accessorFn: (record) => record.started_at || record.created_at,
      size: 110,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnTime")} field="created_at" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {formatLogTime(row.original.started_at || row.original.created_at)}
        </span>
      ),
    },
    {
      id: "type",
      accessorKey: "type",
      size: 100,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnType")} field="type" sort={sort} onSort={handleSort} />,
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
      header: () => <LogSortHeader label={t("columnCategory")} field="category" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge label={categoryLabels[row.original.category]} tone={categoryTone(row.original.category)} />
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      size: 130,
      minSize: 110,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnStatus")} field="status" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => {
        const retries = Math.max(0, (row.original.attempt ?? 1) - 1)
        return (
          <LogStatusCell
            label={statusLabels[row.original.status] || row.original.status}
            tone={statusTone(row.original.status)}
            retries={retries}
            retryLabel={t("retryCount", { count: retries })}
          />
        )
      },
    },
    {
      id: "action",
      accessorKey: "action",
      size: 240,
      minSize: 200,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnAction")} field="action" sort={sort} onSort={handleSort} />,
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
      header: () => <LogSortHeader label={t("columnUser")} field="username" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => row.original.username || "-",
    },
    {
      id: "server_name",
      accessorKey: "server_name",
      size: 160,
      minSize: 130,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnServer")} field="server_name" sort={sort} onSort={handleSort} />,
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
      header: () => <LogSortHeader label={t("columnSource")} field="source" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{row.original.source || "-"}</span>,
    },
    {
      id: "ip",
      accessorKey: "ip",
      size: 130,
      minSize: 110,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnIp")} field="ip" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs">{row.original.ip || "-"}</span>,
    },
    {
      id: "progress",
      accessorKey: "progress",
      size: 150,
      minSize: 130,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnProgress")} field="progress" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <LogProgressCell
          progress={row.original.progress}
          bytesProcessed={row.original.bytes_processed}
          bytesTotal={row.original.bytes_total}
          failed={row.original.status === "failure"}
        />
      ),
    },
    {
      id: "files",
      accessorKey: "total_count",
      size: 90,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: t("columnFiles"),
      cell: ({ row }) => (
        <LogFilesCell
          total={row.original.total_count}
          success={row.original.success_count}
          failed={row.original.failure_count}
          failedLabel={t("filesFailed", { count: row.original.failure_count })}
        />
      ),
    },
    {
      id: "duration_ms",
      accessorKey: "duration_ms",
      size: 100,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnDuration")} field="duration_ms" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => formatLogDuration(row.original.duration_ms),
    },
    {
      id: "result",
      accessorFn: (record) => record.error_message || record.resource || record.source || "",
      size: 260,
      minSize: 220,
      meta: meta({ align: "left" }),
      header: t("columnResult"),
      cell: ({ row }) => {
        const result = row.original.error_message || row.original.resource || row.original.source || "-"
        return (
          <span className="block w-full truncate text-muted-foreground" title={result === "-" ? undefined : result}>
            {result}
          </span>
        )
      },
    },
  ]}, [categoryLabels, handleSort, sort, statusLabels, t, typeLabels])

  const filterOptions = React.useMemo(() => {
    const typeOptions: ServerFilterOption[] = [
      { label: t("typeConnection"), value: "connection" },
      { label: t("typeTransfer"), value: "transfer" },
      { label: t("typeExecution"), value: "execution" },
      { label: t("typeAudit"), value: "audit" },
    ]
    const categoryOptions: ServerFilterOption[] = [
      { label: t("categoryActivity"), value: "activity" },
      { label: t("categoryAudit"), value: "audit" },
    ]
    const statusOptions: ServerFilterOption[] = (
      ["pending", "running", "success", "failure", "partial", "canceled", "timeout", "warning"] as const
    ).map((value) => ({ label: statusLabels[value], value }))
    return { typeOptions, categoryOptions, statusOptions }
  }, [statusLabels, t])

  return (
    // 内容画布填满可视高度，剩余高度交给表格行区域；固定部分本身放不下时才由外层页面滚动。
    <DashboardPageContent className="min-h-auto gap-3 sm:gap-4">
      <ActivityOverview server={filteredServer} />
      <LogTableSummary
        description={t("dashboardDescription")}
        updatedAt={t("lastUpdated", {
          time: recordsQuery.dataUpdatedAt
            ? formatLogTime(new Date(recordsQuery.dataUpdatedAt).toISOString())
            : "-",
        })}
      />

      <DataTable
        data={records}
        columns={recordColumns}
        loading={loading && records.length === 0}
        currentPage={page}
        pageCount={totalPages}
        pageSize={pageSize}
        totalRows={totalRows}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        emptyMessage={t("empty")}
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
              <LogFilterBar
                filters={filters}
                onFiltersChange={setFilters}
                onApply={handleApplyFilters}
                onReset={handleResetFilters}
                canReset={hasActiveLogFilters(filters) || hasActiveLogFilters(appliedFilters)}
                {...filterOptions}
                serverOptions={serverOptions}
                t={t}
              />
            }
            showRefresh
            onRefresh={handleRefresh}
            isRefreshing={refreshing}
          >
            <Button variant="outline" size="sm" onClick={() => downloadLogsJson(table.getFilteredRowModel().rows.map((row) => row.original), "operation-records")} className="h-8">
              <Download className="mr-2 h-4 w-4" />
              {t("exportCurrentPage")}
            </Button>
          </DataTableToolbar>
        )}
      />

      <Dialog open={isDetailDialogOpen} onOpenChange={(open) => {
        setIsDetailDialogOpen(open)
        if (!open) {
          setSelectedId(null)
          setCopied(false)
        }
      }}>
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
              <ActivityLinks sourceTable={selectedRecord.source_table} sourceId={selectedRecord.source_id} resources={selectedRecord.resources} />
              <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <LogDetailItem label={t("columnType")} value={typeLabels[selectedRecord.type]} />
                <LogDetailItem label={t("columnCategory")} value={categoryLabels[selectedRecord.category]} />
                <LogDetailItem label={t("columnStatus")} value={statusLabels[selectedRecord.status] || selectedRecord.status} />
                <LogDetailItem label={t("columnAction")} value={actionLabel(t, selectedRecord.action)} />
                <LogDetailItem label={t("columnUser")} value={selectedRecord.username || "-"} />
                <LogDetailItem label={t("columnServer")} value={selectedRecord.server_name || "-"} />
                <LogDetailItem label={t("columnSource")} value={selectedRecord.source || "-"} />
                <LogDetailItem label={t("columnIp")} value={selectedRecord.ip || "-"} />
                <LogDetailItem label={t("columnDuration")} value={formatLogDuration(selectedRecord.duration_ms)} />
                <LogDetailItem label={t("detailStartedAt")} value={formatDateTime(selectedRecord.started_at || selectedRecord.created_at)} />
                <LogDetailItem label={t("detailFinishedAt")} value={formatDateTime(selectedRecord.finished_at)} />
                <LogDetailItem
                  label={t("detailTraffic")}
                  value={selectedRecord.bytes_total > 0 || selectedRecord.bytes_processed > 0
                    ? `${formatLogBytes(selectedRecord.bytes_processed)} / ${formatLogBytes(selectedRecord.bytes_total)}`
                    : "-"}
                />
              </div>
              <div className="rounded-lg border bg-muted/25 p-4">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
                  <span>{t(`detailPreview${selectedRecord.type.charAt(0).toUpperCase()}${selectedRecord.type.slice(1)}`)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("copy")}
                    title={t("copy")}
                    disabled={!detailPreviewValue}
                    onClick={() => void handleCopyDetail()}
                  >
                    <CopyCheckIcon copied={copied} size={14} />
                  </Button>
                </div>
                <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-3 font-mono text-xs text-muted-foreground">
                  {detailPreviewValue}
                </pre>
              </div>
            </div>
          ) : detailQuery.isPending ? (
            <PageLoading className="min-h-56" />
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardPageContent>
  )
}
