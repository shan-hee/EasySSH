
import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  KeyRound,
  Search,
  ShieldAlert,
  ShieldCheck,
  User,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/sonner"
import { getErrorMessage } from "@/lib/error-utils"
import { logsApi, type AuditLog, type AuditLogListParams, type AuditLogStatisticsResponse } from "@/lib/api/logs"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import {
  DashboardDonutCard,
  DashboardMetricCard,
  DashboardSideList,
  DashboardStatusLine,
  DashboardTrendCard,
  InlineStatusBadge,
  type DashboardTone,
  type DonutItem,
} from "./log-dashboard-widgets"

interface LogsPageData {
  logs: AuditLog[]
  statistics: AuditLogStatisticsResponse | null
  totalPages: number
  totalCount: number
  currentPage: number
  pageSize: number
}

interface LogsClientProps {
  initialData?: LogsPageData
  defaultAction?: string
  api?: Pick<typeof logsApi, "list" | "getStatistics">
}

const TREND_BUCKETS = 12
const DAY_MS = 24 * 60 * 60 * 1000
const ALL_VALUE = "__all"

type SortOrder = "asc" | "desc"

interface LogFilters {
  type: string
  category: string
  status: string
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
  type: ALL_VALUE,
  category: ALL_VALUE,
  status: ALL_VALUE,
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
    sftp_delete: t("actionDelete"),
    sftp_rename: t("actionRename"),
    sftp_mkdir: t("actionMkdir"),
    monitoring_query: t("actionMonitoringQuery"),
    server_create: t("actionServerCreate"),
    server_update: t("actionServerUpdate"),
    server_delete: t("actionServerDelete"),
    server_test: t("actionServerTest"),
    user_create: t("actionUserCreate"),
    user_update: t("actionUserUpdate"),
    user_delete: t("actionUserDelete"),
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
    type: filters.type === ALL_VALUE ? undefined : filters.type as AuditLogListParams["type"],
    category: filters.category === ALL_VALUE ? undefined : filters.category as AuditLogListParams["category"],
    status: filters.status === ALL_VALUE ? undefined : filters.status,
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
      return value !== ALL_VALUE
    }
    return value.trim() !== ""
  })
}

function getTodayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  end.setMilliseconds(end.getMilliseconds() - 1)

  return {
    start_date: start.toISOString(),
    end_date: end.toISOString(),
  }
}

function getLast24HoursRange() {
  const end = new Date()
  return {
    start_date: new Date(end.getTime() - DAY_MS).toISOString(),
    end_date: end.toISOString(),
  }
}

function getTrendBucketIndex(value?: string) {
  if (!value) return -1
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return -1

  const now = Date.now()
  const start = now - DAY_MS
  if (timestamp < start || timestamp > now) return -1

  return Math.min(TREND_BUCKETS - 1, Math.floor(((timestamp - start) / DAY_MS) * TREND_BUCKETS))
}

function buildTrend(logs: AuditLog[], predicate: (log: AuditLog) => boolean = () => true) {
  const buckets = Array.from({ length: TREND_BUCKETS }, () => 0)
  logs.forEach((log) => {
    if (!predicate(log)) return
    const bucket = getTrendBucketIndex(log.created_at)
    if (bucket < 0) return
    buckets[bucket] += 1
  })
  return buckets
}

function buildUniqueUserTrend(logs: AuditLog[]) {
  const buckets = Array.from({ length: TREND_BUCKETS }, () => new Set<string>())
  logs.forEach((log) => {
    const bucket = getTrendBucketIndex(log.created_at)
    if (bucket < 0) return
    const userKey = log.user_id || log.username
    if (userKey) {
      buckets[bucket].add(userKey)
    }
  })
  return buckets.map((bucket) => bucket.size)
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

export function LogsClient({ initialData, defaultAction, api = logsApi }: LogsClientProps) {
  const { ready } = useAuthReady()
  const { t } = useTranslation("logsAudit")
  const [logs, setLogs] = React.useState<AuditLog[]>(initialData?.logs || [])
  const [statistics, setStatistics] = React.useState<AuditLogStatisticsResponse | null>(initialData?.statistics || null)
  const [initialLoading, setInitialLoading] = React.useState(!initialData)
  const [tableLoading, setTableLoading] = React.useState(false)
  const [trendLogs, setTrendLogs] = React.useState<AuditLog[]>(initialData?.logs || [])
  const [page, setPage] = React.useState(initialData?.currentPage || 1)
  const [pageSize, setPageSize] = React.useState(initialData?.pageSize || 20)
  const [totalPages, setTotalPages] = React.useState(initialData?.totalPages || 1)
  const [totalRows, setTotalRows] = React.useState(initialData?.totalCount || 0)
  const [selectedLogId, setSelectedLogId] = React.useState<string | null>(null)
  const [filters, setFilters] = React.useState<LogFilters>(defaultFilters)
  const [sort, setSort] = React.useState<LogSortState>(defaultSort)

  const loadStatistics = React.useCallback(async (
    nextFilters: LogFilters = filters,
    nextSort: LogSortState = sort,
  ) => {
    try {
      const todayRange = getTodayRange()
      const filterParams = filtersToParams(nextFilters)
      const [statsResponse, recentResponse] = await Promise.all([
        api.getStatistics({
          category: filterParams.category,
          start_date: filterParams.start_date || todayRange.start_date,
          end_date: filterParams.end_date || todayRange.end_date,
        }),
        api.list({
          page: 1,
          page_size: 100,
          action: defaultAction,
          ...filterParams,
          ...nextSort,
          ...getLast24HoursRange(),
        }),
      ])
      setStatistics(statsResponse)
      setTrendLogs(recentResponse.logs || [])
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("toastLoadFailed")))
    }
  }, [api, defaultAction, filters, sort, t])

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
        await Promise.all([loadLogs(page, pageSize), loadStatistics()])
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

  const actionEntries = React.useMemo(() => {
    const stats = statistics?.action_stats || {}
    return Object.entries(stats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [statistics])

  const donutItems = React.useMemo<DonutItem[]>(() => {
    if (actionEntries.length > 0) {
      return actionEntries.map(([action, count]) => ({
        label: actionLabel(t, action),
        value: count,
      }))
    }
    const fallback = new Map<string, number>()
    logs.forEach((log) => fallback.set(log.action, (fallback.get(log.action) || 0) + 1))
    return Array.from(fallback.entries()).slice(0, 5).map(([action, count]) => ({
      label: actionLabel(t, action),
      value: count,
    }))
  }, [actionEntries, logs, t])

  const trend = React.useMemo(() => buildTrend(trendLogs), [trendLogs])
  const failureTrend = React.useMemo(
    () => buildTrend(trendLogs, (log) => log.status === "failure"),
    [trendLogs]
  )
  const successTrend = React.useMemo(
    () => buildTrend(trendLogs, (log) => log.status === "success"),
    [trendLogs]
  )
  const riskTrend = React.useMemo(
    () => buildTrend(trendLogs, (log) => log.status !== "success"),
    [trendLogs]
  )
  const activeUserTrend = React.useMemo(() => buildUniqueUserTrend(trendLogs), [trendLogs])
  const hasTrendData = trend.some((value) => value > 0)
  const failureRate = statistics?.total_logs
    ? Math.round(((statistics.failure_count || 0) / statistics.total_logs) * 100)
    : 0
  const activeUserCount = React.useMemo(() => (
    new Set(trendLogs.map((log) => log.user_id || log.username).filter(Boolean)).size
  ), [trendLogs])

  const recentAlerts = React.useMemo(() => {
    const failures = statistics?.recent_failures?.length
      ? statistics.recent_failures
      : trendLogs.filter((log) => log.status !== "success")
    return failures.slice(0, 5).map((log) => ({
      id: log.id,
      icon: log.status === "warning" ? AlertTriangle : ShieldAlert,
      title: actionLabel(t, log.action),
      description: `${log.username || "-"} / ${log.ip || "-"}`,
      time: formatTime(log.created_at),
      tone: statusTone(log.status),
    }))
  }, [statistics, t, trendLogs])

  const handleRefresh = () => {
    void Promise.all([
      loadLogs(page, pageSize, { showTableLoading: true }),
      loadStatistics(),
    ])
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
    void Promise.all([
      loadLogs(1, pageSize, { showTableLoading: true }),
      loadStatistics(),
    ])
  }

  const handleResetFilters = () => {
    const nextFilters = { ...defaultFilters }
    setFilters(nextFilters)
    setPage(1)
    setSelectedLogId(null)
    void Promise.all([
      loadLogs(1, pageSize, { showTableLoading: true, filters: nextFilters }),
      loadStatistics(nextFilters),
    ])
  }

  const handleSort = React.useCallback((field: string) => {
    const nextSort: LogSortState = sort.sort_by === field
      ? { sort_by: field, sort_order: sort.sort_order === "asc" ? "desc" : "asc" }
      : { sort_by: field, sort_order: "desc" }
    setSort(nextSort)
    setPage(1)
    void loadLogs(1, pageSize, { showTableLoading: true, sort: nextSort })
  }, [loadLogs, pageSize, sort])

  const logColumns = React.useMemo<ColumnDef<AuditLog>[]>(() => [
    {
      id: "created_at",
      accessorKey: "created_at",
      header: () => <SortableHeader label={t("columnTime")} field="created_at" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {formatTime(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "type",
      accessorKey: "type",
      header: () => <SortableHeader label={t("columnType")} field="type" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge
          label={typeLabel(t, row.original.type)}
          tone={row.original.type === "audit" ? "amber" : actionTone(row.original.action)}
        />
      ),
    },
    {
      id: "category",
      accessorKey: "category",
      header: () => <SortableHeader label={t("columnCategory")} field="category" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge
          label={categoryLabel(t, row.original.category)}
          tone={row.original.category === "audit" ? "violet" : "emerald"}
        />
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: () => <SortableHeader label={t("columnStatus")} field="status" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge
          label={statusLabel(t, row.original.status)}
          tone={statusTone(row.original.status)}
        />
      ),
      filterFn: (row, id, value) => {
        const selected = (value as string[]) || []
        if (selected.length === 0) return true
        return selected.includes(row.getValue(id) as string)
      },
    },
    {
      id: "action",
      accessorKey: "action",
      header: () => <SortableHeader label={t("columnAction")} field="action" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge
          label={actionLabel(t, row.original.action)}
          tone={actionTone(row.original.action)}
        />
      ),
    },
    {
      id: "username",
      accessorKey: "username",
      header: () => <SortableHeader label={t("columnUser")} field="username" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => row.original.username || "-",
    },
    {
      id: "resource",
      accessorKey: "resource",
      header: () => <SortableHeader label={t("columnResource")} field="resource" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="block max-w-[180px] truncate" title={row.original.resource || undefined}>
          {row.original.resource || "-"}
        </span>
      ),
    },
    {
      id: "source",
      accessorKey: "source",
      header: () => <SortableHeader label={t("columnSource")} field="source" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {row.original.source || "-"}
        </span>
      ),
    },
    {
      id: "ip",
      accessorKey: "ip",
      header: () => <SortableHeader label={t("columnIp")} field="ip" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {row.original.ip || "-"}
        </span>
      ),
    },
    {
      id: "duration",
      accessorKey: "duration",
      header: () => <SortableHeader label={t("columnDuration")} field="duration_ms" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {formatDuration(row.original.duration)}
        </span>
      ),
    },
    {
      id: "details",
      accessorKey: "details",
      header: t("columnDetails"),
      cell: ({ row }) => {
        const details = row.original.details || row.original.error_msg || "-"
        return (
          <span className="block max-w-[260px] truncate text-muted-foreground" title={details === "-" ? undefined : details}>
            {details}
          </span>
        )
      },
      filterFn: (row, _id, value) => {
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
  ], [handleSort, sort, t])

  const total = statistics?.total_logs || 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0 xl:overflow-hidden">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>{t("activityDashboardDescription")}</p>
        <DashboardStatusLine label={t("collectionHealthy")} timestamp={formatDateTime(new Date().toISOString())} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <DashboardMetricCard title={t("metricTodayEvents")} value={total} icon={Activity} tone="emerald" spark={trend} loading={initialLoading} />
        <DashboardMetricCard title={t("metricFailedLogins")} value={statistics?.failure_count || 0} icon={AlertTriangle} tone="rose" spark={failureTrend} loading={initialLoading} />
        <DashboardMetricCard title={t("metricCommandRuns")} value={statistics?.success_count || 0} icon={ShieldCheck} tone="blue" spark={successTrend} loading={initialLoading} />
        <DashboardMetricCard title={t("metricSecurityAlerts")} value={`${failureRate}%`} icon={ShieldAlert} tone="amber" spark={riskTrend} loading={initialLoading} />
        <DashboardMetricCard title={t("metricActiveUsers")} value={activeUserCount} icon={User} tone="violet" spark={activeUserTrend} loading={initialLoading} />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,0.85fr)] xl:overflow-hidden">
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
          className="min-h-[520px] overflow-hidden xl:min-h-0"
          scrollContainerClassName="min-h-[360px]"
          tableClassName="min-w-[1180px]"
          density="compact"
          onRowClick={(log) => setSelectedLogId(log.id)}
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
                  t={t}
                />
              }
              showRefresh
              onRefresh={handleRefresh}
              isRefreshing={tableLoading}
            >
              <Button variant="outline" size="sm" onClick={() => exportLogs(table.getFilteredRowModel().rows.map((row) => row.original))} className="h-8">
                <Download className="mr-2 h-4 w-4" />
                {t("exportLogs")}
              </Button>
            </DataTableToolbar>
          )}
        />

        <div className="grid min-h-0 gap-3 overflow-visible xl:overflow-auto">
          <DashboardTrendCard title={t("activityTrendTitle")} label={t("last24Hours")} data={hasTrendData ? trend : []} tone="emerald" emptyLabel={t("activityEmpty")} loading={initialLoading} />
          <DashboardDonutCard title={t("riskDistributionTitle")} totalLabel={t("totalLabel")} totalValue={total} items={donutItems} loading={initialLoading} />
          <DashboardSideList title={t("recentAlertsTitle")} empty={t("activityEmpty")} items={recentAlerts} />
          <Card className="gap-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{t("logDetailsTitle")}</h2>
              {selectedLog && <InlineStatusBadge label={actionLabel(t, selectedLog.action)} tone={actionTone(selectedLog.action)} />}
              {selectedLog && <span className="font-mono text-xs text-muted-foreground">ID: {selectedLog.id}</span>}
            </div>
            {selectedLog ? (
              <div className="mt-4 grid gap-4">
                <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-1">
                  <Detail label={t("columnTime")} value={`${formatDate(selectedLog.created_at)} ${formatTime(selectedLog.created_at)}`} />
                  <Detail label={t("columnUser")} value={selectedLog.username || "-"} />
                  <Detail label={t("columnResource")} value={selectedLog.resource || "-"} />
                  <Detail label={t("columnIp")} value={selectedLog.ip || "-"} />
                  <Detail label={t("columnStatus")} value={statusLabel(t, selectedLog.status)} />
                  <Detail label={t("columnDuration")} value={formatDuration(selectedLog.duration)} />
                  <Detail label={t("columnCategory")} value={categoryLabel(t, selectedLog.category)} />
                  <Detail label={t("columnAction")} value={actionLabel(t, selectedLog.action)} />
                  <Detail label={t("columnServer")} value={selectedLog.server_id || "-"} />
                </div>
                <div className="rounded-lg border bg-muted/25 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    {t("detailPayloadTitle")}
                  </div>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                    {selectedLog.details || selectedLog.error_msg || selectedLog.user_agent || "-"}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-muted-foreground">{t("emptyMessage")}</div>
            )}
          </Card>
        </div>
      </div>
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
  t,
}: {
  filters: LogFilters
  onFiltersChange: React.Dispatch<React.SetStateAction<LogFilters>>
  onApply: () => void
  onReset: () => void
  hasActiveFilters: boolean
  t: (key: string) => string
}) {
  const updateFilter = (key: keyof LogFilters, value: string) => {
    onFiltersChange((current) => ({ ...current, [key]: value }))
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Enter") {
      onApply()
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Input
        value={filters.keyword}
        placeholder={t("filterKeywordPlaceholder")}
        onChange={(event) => updateFilter("keyword", event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-8 w-full min-w-[180px] sm:w-[220px]"
      />
      <Select value={filters.type} onValueChange={(value) => updateFilter("type", value)}>
        <SelectTrigger className="h-8 w-full sm:w-[150px]">
          <SelectValue placeholder={t("filterTypeTitle")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t("filterAll")}</SelectItem>
          <SelectItem value="connection">{t("typeConnection")}</SelectItem>
          <SelectItem value="transfer">{t("typeTransfer")}</SelectItem>
          <SelectItem value="execution">{t("typeExecution")}</SelectItem>
          <SelectItem value="audit">{t("typeAudit")}</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.category} onValueChange={(value) => updateFilter("category", value)}>
        <SelectTrigger className="h-8 w-full sm:w-[140px]">
          <SelectValue placeholder={t("filterCategoryTitle")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t("filterAll")}</SelectItem>
          <SelectItem value="activity">{t("categoryActivity")}</SelectItem>
          <SelectItem value="audit">{t("categoryAudit")}</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.status} onValueChange={(value) => updateFilter("status", value)}>
        <SelectTrigger className="h-8 w-full sm:w-[140px]">
          <SelectValue placeholder={t("filterStatusTitle")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t("filterAll")}</SelectItem>
          <SelectItem value="pending">{t("statusPending")}</SelectItem>
          <SelectItem value="running">{t("statusRunning")}</SelectItem>
          <SelectItem value="success">{t("filterStatusSuccessLabel")}</SelectItem>
          <SelectItem value="failure">{t("filterStatusFailureLabel")}</SelectItem>
          <SelectItem value="partial">{t("statusPartial")}</SelectItem>
          <SelectItem value="canceled">{t("statusCanceled")}</SelectItem>
          <SelectItem value="timeout">{t("statusTimeout")}</SelectItem>
          <SelectItem value="warning">{t("filterStatusWarningLabel")}</SelectItem>
        </SelectContent>
      </Select>
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
      <Input
        type="date"
        value={filters.start_date}
        aria-label={t("filterStartDate")}
        onChange={(event) => updateFilter("start_date", event.target.value)}
        className="h-8 w-full sm:w-[150px]"
      />
      <Input
        type="date"
        value={filters.end_date}
        aria-label={t("filterEndDate")}
        onChange={(event) => updateFilter("end_date", event.target.value)}
        className="h-8 w-full sm:w-[150px]"
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
