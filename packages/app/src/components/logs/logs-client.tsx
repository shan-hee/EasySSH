import { ActivityLinks } from "@/components/activity/activity-links"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, Row } from "@tanstack/react-table"
import { Download } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useAuthReady } from "@/hooks/use-auth-ready"
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
import { Spinner } from "@/components/ui/spinner"
import { getErrorMessage } from "@/lib/error-utils"
import { serversApi } from "@/lib/api/servers"
import type {
  AuditLog,
  AuditLogListParams,
  AuditLogStatus,
  AuditLogSummary,
} from "@/lib/log-types"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"
import {
  InlineStatusBadge,
  type DashboardTone,
} from "./log-dashboard-widgets"
import { auditLogDetailPreview } from "./audit-log-utils"
import {
  LogFilterBar,
  createLogFilters,
  hasActiveLogFilters,
  useLogServerOptions,
  type LogFilterValues,
  type LogServersApi,
  type ServerFilterOption,
} from "./log-server-filters"
import {
  LogDetailItem,
  LogFilesCell,
  LogProgressCell,
  LogSortHeader,
  LogStatusCell,
  LogTableSummary,
  defaultLogSort,
  downloadLogsJson,
  formatLogDuration,
  formatLogTime,
  nextLogSort,
  type LogSortState,
} from "./log-table-parts"
import { queryKeys } from "@/lib/query-keys"
import { auditLogsQueryOptions } from "@/lib/dashboard-query-options"
import { PageLoading } from "@/components/page-loading"

interface LogsClientProps {
  defaultAction?: string
  desktopMode?: boolean
  /** 渲染在说明行上方的统计概览，与表格共用同一内容画布与滚动容器；参数为表格当前生效的服务器筛选。 */
  overview?: (context: { server: { id: string; name: string } | null }) => React.ReactNode
  /** 服务器筛选的数据源，默认使用 Web 接口；桌面端传入本地适配器。 */
  servers?: LogServersApi
  api: {
    list: (params?: AuditLogListParams) => Promise<{
      logs: AuditLogSummary[]
      total: number
      page: number
      page_size: number
      total_pages: number
    }>
    getById: (id: string) => Promise<AuditLog>
  }
}

const defaultFilters = createLogFilters()

// 单机桌面端没有多用户、来源与 IP；服务器、进度与文件统计目前只有桌面端活动记录提供。
const webOnlyColumns = ["category", "username", "source", "ip"]
const desktopOnlyColumns = ["server_name", "progress", "files"]

function formatDate(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
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
    audit_logs_cleanup: t("actionAuditLogsCleanup"),
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

function statusTone(status: AuditLogStatus): DashboardTone {
  if (status === "success") return "emerald"
  if (status === "running" || status === "pending") return "blue"
  if (status === "warning" || status === "partial" || status === "timeout") return "amber"
  return "rose"
}

function statusLabel(t: (key: string) => string, status: AuditLogStatus) {
  if (status === "success") return t("filterStatusSuccessLabel")
  if (status === "warning") return t("filterStatusWarningLabel")
  if (status === "pending") return t("statusPending")
  if (status === "running") return t("statusRunning")
  if (status === "partial") return t("statusPartial")
  if (status === "canceled") return t("statusCanceled")
  if (status === "timeout") return t("statusTimeout")
  if (status === "unknown") return t("statusUnknown")
  return t("filterStatusFailureLabel")
}

function typeLabel(t: (key: string) => string, type?: AuditLogSummary["type"]) {
  if (type === "connection") return t("typeConnection")
  if (type === "transfer") return t("typeTransfer")
  if (type === "execution") return t("typeExecution")
  if (type === "audit") return t("typeAudit")
  return "-"
}

function categoryLabel(t: (key: string) => string, category?: AuditLogSummary["category"]) {
  if (category === "activity") return t("categoryActivity")
  if (category === "audit") return t("categoryAudit")
  return "-"
}

function detailTitle(t: (key: string) => string, type?: AuditLogSummary["type"]) {
  if (type === "connection") return t("detailTitleConnection")
  if (type === "transfer") return t("detailTitleTransfer")
  if (type === "execution") return t("detailTitleExecution")
  if (type === "audit") return t("detailTitleAudit")
  return t("logDetailsTitle")
}

function auditLogSummaryPreview(log: AuditLogSummary | null) {
  if (!log) return "-"
  return log.error_msg || log.resource || "-"
}

function filtersToParams(filters: LogFilterValues): Pick<AuditLogListParams, "type" | "category" | "status" | "server_id" | "source" | "ip" | "keyword" | "start_date" | "end_date"> {
  return {
    server_id: filters.server_id || undefined,
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

export function LogsClient({ defaultAction, desktopMode = false, overview, servers = serversApi, api }: LogsClientProps) {
  const { ready } = useAuthReady()
  const { t } = useTranslation("logsAudit")
  const queryClient = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [selectedLogId, setSelectedLogId] = React.useState<string | null>(null)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [filters, setFilters] = React.useState<LogFilterValues>(defaultFilters)
  const [appliedFilters, setAppliedFilters] = React.useState<LogFilterValues>(defaultFilters)
  const [sort, setSort] = React.useState<LogSortState>(defaultLogSort)
  const copyResetTimerRef = React.useRef<number | null>(null)
  const serverOptions = useLogServerOptions(servers, ready)
  const filteredServer = React.useMemo(() => {
    const id = appliedFilters.server_id
    if (!id) return null
    return { id, name: serverOptions.find((option) => option.value === id)?.label ?? id }
  }, [appliedFilters.server_id, serverOptions])
  const queryParams = React.useMemo<AuditLogListParams>(() => ({
    page,
    page_size: pageSize,
    action: defaultAction,
    ...filtersToParams(appliedFilters),
    ...sort,
  }), [appliedFilters, defaultAction, page, pageSize, sort])
  const logsQuery = useQuery({
    ...auditLogsQueryOptions(queryParams, api),
    enabled: ready,
    refetchInterval: (query) => (
      query.state.data?.logs.some((log) => log.status === "pending" || log.status === "running")
        ? 3_000
        : 60_000
    ),
  })
  const detailQuery = useQuery({
    queryKey: queryKeys.logs.auditDetail(selectedLogId ?? "none"),
    queryFn: () => api.getById(selectedLogId as string),
    enabled: ready && isDetailDialogOpen && selectedLogId !== null,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "pending" || status === "running" ? 3_000 : false
    },
  })
  const logs = React.useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data?.logs])
  const totalPages = Math.max(1, logsQuery.data?.total_pages ?? 1)
  const totalRows = logsQuery.data?.total ?? 0
  const initialLoading = logsQuery.isPending
  const tableLoading = logsQuery.isFetching && !logsQuery.isPending

  React.useEffect(() => {
    if (!logsQuery.error) return
    toast.error(getErrorMessage(logsQuery.error, t("toastLoadFailed")))
  }, [logsQuery.error, t])

  React.useEffect(() => {
    if (!detailQuery.error || detailQuery.data) return
    toast.error(getErrorMessage(detailQuery.error, t("detailLoadFailed")))
  }, [detailQuery.data, detailQuery.error, t])

  React.useEffect(() => {
    if (page > totalPages && !logsQuery.isPlaceholderData) setPage(totalPages)
  }, [logsQuery.isPlaceholderData, page, totalPages])

  React.useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
  }, [])

  const selectedSummary = React.useMemo(
    () => logs.find((log) => log.id === selectedLogId) || null,
    [logs, selectedLogId]
  )
  const selectedLog = detailQuery.data ?? selectedSummary
  const detailPreviewValue = auditLogDetailPreview(detailQuery.data)

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

  const handleRefresh = () => {
    void logsQuery.refetch()
    if (isDetailDialogOpen && selectedLogId) void detailQuery.refetch()
  }

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage)
  }

  const handlePageSizeChange = (nextSize: number) => {
    setPageSize(nextSize)
    setPage(1)
  }

  const handleApplyFilters = () => {
    setPage(1)
    setSelectedLogId(null)
    setIsDetailDialogOpen(false)
    setAppliedFilters(filters)
  }

  const handleResetFilters = () => {
    setFilters(defaultFilters)
    setAppliedFilters(defaultFilters)
    setPage(1)
    setSelectedLogId(null)
    setIsDetailDialogOpen(false)
  }

  const handleSort = React.useCallback((field: string) => {
    setSort(nextLogSort(sort, field))
    setPage(1)
    setSelectedLogId(null)
    setIsDetailDialogOpen(false)
    setCopied(false)
  }, [sort])

  const logColumns = React.useMemo<ColumnDef<AuditLogSummary>[]>(() => {
    const meta = (m: DataTableColumnMeta): DataTableColumnMeta => m
    return [
    {
      id: "created_at",
      accessorKey: "created_at",
      size: 110,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnTime")} field="created_at" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {formatLogTime(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "type",
      accessorKey: "type",
      size: 90,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnType")} field="type" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <InlineStatusBadge
          label={typeLabel(t, row.original.type)}
          tone={row.original.type === "audit" ? "amber" : actionTone(row.original.action)}
        />
      ),
    },
    {
      id: "category",
      accessorKey: "category",
      size: 100,
      minSize: 90,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnCategory")} field="category" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <InlineStatusBadge
          label={categoryLabel(t, row.original.category)}
          tone={row.original.category === "audit" ? "violet" : "emerald"}
        />
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      size: 130,
      minSize: 110,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnStatus")} field="status" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => {
        const retries = Math.max(0, (row.original.attempt ?? 1) - 1)
        return (
          <LogStatusCell
            label={statusLabel(t, row.original.status)}
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
      size: 130,
      minSize: 110,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnAction")} field="action" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <InlineStatusBadge
          label={actionLabel(t, row.original.action)}
          tone={actionTone(row.original.action)}
        />
      ),
    },
    {
      id: "username",
      accessorKey: "username",
      size: 110,
      minSize: 90,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnUser")} field="username" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => row.original.username || "-",
    },
    {
      id: "server_name",
      accessorKey: "server_name",
      size: 120,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: t("columnServer"),
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <span className="block w-full truncate" title={row.original.server_name || undefined}>
          {row.original.server_name || "-"}
        </span>
      ),
    },
    {
      id: "resource",
      accessorKey: "resource",
      size: 150,
      minSize: 120,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnResource")} field="resource" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <span className="block w-full truncate" title={row.original.resource || undefined}>
          {row.original.resource || "-"}
        </span>
      ),
    },
    {
      id: "source",
      accessorKey: "source",
      size: 90,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnSource")} field="source" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {row.original.source || "-"}
        </span>
      ),
    },
    {
      id: "ip",
      accessorKey: "ip",
      size: 120,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnIp")} field="ip" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {row.original.ip || "-"}
        </span>
      ),
    },
    {
      id: "progress",
      accessorKey: "progress",
      size: 150,
      minSize: 130,
      meta: meta({ align: "left" }),
      header: t("columnProgress"),
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <LogProgressCell
          progress={row.original.progress ?? 0}
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
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <LogFilesCell
          total={row.original.total_count}
          success={row.original.success_count}
          failed={row.original.failure_count}
          failedLabel={t("filesFailed", { count: row.original.failure_count ?? 0 })}
        />
      ),
    },
    {
      id: "duration",
      accessorKey: "duration",
      size: 90,
      minSize: 80,
      meta: meta({ align: "left" }),
      header: () => <LogSortHeader label={t("columnDuration")} field="duration_ms" sort={sort} onSort={handleSort} />,
      cell: ({ row }: { row: Row<AuditLogSummary> }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {formatLogDuration(row.original.duration)}
        </span>
      ),
    },
    {
      id: "details",
      accessorFn: (log: AuditLogSummary) => log.error_msg || log.resource || log.source || "",
      size: 180,
      minSize: 150,
      meta: meta({ align: "left" }),
      header: t("columnDetails"),
      cell: ({ row }: { row: Row<AuditLogSummary> }) => {
        const details = row.original.error_msg || row.original.resource || row.original.source || "-"
        return (
          <span className="block w-full truncate text-muted-foreground" title={details === "-" ? undefined : details}>
            {details}
          </span>
        )
      },
    },
  ].filter((column) => !(desktopMode ? webOnlyColumns : desktopOnlyColumns).includes(column.id ?? ""))
  }, [desktopMode, handleSort, sort, t])

  const filterOptions = React.useMemo(() => {
    const typeOptions: ServerFilterOption[] = [
      { label: t("typeConnection"), value: "connection" },
      { label: t("typeTransfer"), value: "transfer" },
      { label: t("typeExecution"), value: "execution" },
      ...(desktopMode ? [] : [{ label: t("typeAudit"), value: "audit" }]),
    ]
    const categoryOptions: ServerFilterOption[] | undefined = desktopMode ? undefined : [
      { label: t("categoryActivity"), value: "activity" },
      { label: t("categoryAudit"), value: "audit" },
    ]
    const statusOptions: ServerFilterOption[] = [
      { label: t("statusPending"), value: "pending" },
      { label: t("statusRunning"), value: "running" },
      { label: t("filterStatusSuccessLabel"), value: "success" },
      { label: t("filterStatusFailureLabel"), value: "failure" },
      { label: t("statusPartial"), value: "partial" },
      { label: t("statusCanceled"), value: "canceled" },
      { label: t("statusTimeout"), value: "timeout" },
      { label: t("filterStatusWarningLabel"), value: "warning" },
    ]
    return { typeOptions, categoryOptions, statusOptions }
  }, [desktopMode, t])

  return (
    // 内容画布填满可视高度，剩余高度交给表格行区域；固定部分本身放不下时才由外层页面滚动。
    <DashboardPageContent className="min-h-auto gap-3 sm:gap-4">
      {overview?.({ server: filteredServer })}
      <LogTableSummary
        description={desktopMode ? t("desktopActivityDashboardDescription") : t("activityDashboardDescription")}
        updatedAt={t("lastUpdated", {
          time: logsQuery.dataUpdatedAt
            ? formatLogTime(new Date(logsQuery.dataUpdatedAt).toISOString())
            : "-",
        })}
      />

      <DataTable
        data={logs}
        columns={logColumns}
        loading={initialLoading && logs.length === 0}
        currentPage={page}
        pageCount={totalPages}
        pageSize={pageSize}
        totalRows={totalRows}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        emptyMessage={t("emptyMessage")}
        density="compact"
        onRowClick={(log) => {
          setSelectedLogId(log.id)
          setCopied(false)
          setIsDetailDialogOpen(true)
        }}
        getRowClassName={(log) => (
          selectedSummary?.id === log.id ? "bg-emerald-500/5 hover:bg-emerald-500/10" : undefined
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
                showOriginFilters={!desktopMode}
                t={t}
              />
            }
            showRefresh
            onRefresh={handleRefresh}
            isRefreshing={tableLoading}
          >
            <Button variant="outline" size="sm" onClick={() => downloadLogsJson(table.getFilteredRowModel().rows.map((row) => row.original), "logs")} className="h-8">
              <Download className="mr-2 h-4 w-4" />
              {t("exportCurrentPage")}
            </Button>
          </DataTableToolbar>
        )}
      />

      <Dialog open={isDetailDialogOpen} onOpenChange={(open) => {
        setIsDetailDialogOpen(open)
        if (!open) {
          setSelectedLogId(null)
          setCopied(false)
        }
      }}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
          <DialogHeader className="shrink-0 pr-8">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{detailTitle(t, selectedLog?.type)}</DialogTitle>
              {selectedLog && <InlineStatusBadge label={actionLabel(t, selectedLog.action)} tone={actionTone(selectedLog.action)} />}
              {selectedLog && <span className="font-mono text-xs text-muted-foreground">ID: {selectedLog.id}</span>}
            </div>
            <DialogDescription>{selectedLog?.resource || selectedLog?.source || t("emptyMessage")}</DialogDescription>
          </DialogHeader>
          {selectedLog ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2 scrollbar-custom">
              <ActivityLinks sourceTable={selectedLog.source_table} sourceId={selectedLog.source_id} resources={selectedLog.resources} />
              <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <LogDetailItem label={t("columnTime")} value={`${formatDate(selectedLog.created_at)} ${formatLogTime(selectedLog.created_at)}`} />
                <LogDetailItem label={t("columnType")} value={typeLabel(t, selectedLog.type)} />
                <LogDetailItem label={t("columnResource")} value={selectedLog.resource || "-"} />
                <LogDetailItem label={t("columnSource")} value={selectedLog.source || "-"} />
                <LogDetailItem label={t("columnStatus")} value={statusLabel(t, selectedLog.status)} />
                <LogDetailItem label={t("columnDuration")} value={formatLogDuration(selectedLog.duration)} />
                <LogDetailItem label={t("columnAction")} value={actionLabel(t, selectedLog.action)} />
                <LogDetailItem label={t("columnServer")} value={selectedLog.server_name || selectedLog.server_id || "-"} />
                <LogDetailItem label={t("detailError")} value={selectedLog.error_msg || "-"} />
                <LogDetailItem label={t("detailUserAgent")} value={detailQuery.data?.user_agent || "-"} />
                {!desktopMode ? (
                  <>
                    <LogDetailItem label={t("columnUser")} value={selectedLog.username || "-"} />
                    <LogDetailItem label={t("columnIp")} value={selectedLog.ip || "-"} />
                    <LogDetailItem label={t("columnCategory")} value={categoryLabel(t, selectedLog.category)} />
                  </>
                ) : null}
              </div>
              <div className="rounded-lg border bg-muted/25 p-4">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
                  <span>{t("detailPayloadTitle")}</span>
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
                {detailQuery.isPending && !detailQuery.data ? (
                  <PageLoading className="min-h-24 flex-none rounded-md bg-background/70" />
                ) : (
                  <pre className="min-h-24 max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-3 font-mono text-xs text-muted-foreground">
                    {detailPreviewValue || auditLogSummaryPreview(selectedSummary)}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("emptyMessage")}</div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardPageContent>
  )
}
