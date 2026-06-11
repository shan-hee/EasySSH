import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileText,
  History,
  Rocket,
  Search,
  TerminalSquare,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/sonner"
import { getErrorMessage } from "@/lib/error-utils"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import {
  operationRecordsApi,
  type OperationRecord,
  type OperationRecordCategory,
  type OperationRecordListParams,
  type OperationRecordStatistics,
  type OperationRecordStatus,
  type OperationRecordType,
} from "@/lib/api/operation-records"
import { useAuthReady } from "@/hooks/use-auth-ready"
import {
  DashboardDonutCard,
  DashboardMetricCard,
  DashboardSideList,
  DashboardStatusLine,
  DashboardTrendCard,
  InlineStatusBadge,
  type DashboardTone,
  type DonutItem,
} from "./logs/components/log-dashboard-widgets"

const TREND_BUCKETS = 12
const DAY_MS = 24 * 60 * 60 * 1000
const ALL_VALUE = "__all"
const EMPTY_BY_TYPE: Partial<Record<OperationRecordType, number>> = {}

type SortOrder = "asc" | "desc"

interface OperationRecordFilters {
  type: string
  category: string
  status: string
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
    type: type || ALL_VALUE,
    category: ALL_VALUE,
    status: ALL_VALUE,
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

function buildTrend(records: OperationRecord[], predicate: (record: OperationRecord) => boolean = () => true) {
  const buckets = Array.from({ length: TREND_BUCKETS }, () => 0)
  records.forEach((record) => {
    if (!predicate(record)) return
    const bucket = getTrendBucketIndex(record.started_at || record.created_at)
    if (bucket < 0) return
    buckets[bucket] += Math.max(1, record.success_count + record.failure_count || 1)
  })
  return buckets
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
    type: filters.type === ALL_VALUE ? undefined : filters.type as OperationRecordType,
    category: filters.category === ALL_VALUE ? undefined : filters.category as OperationRecordCategory,
    status: filters.status === ALL_VALUE ? undefined : filters.status as OperationRecordStatus,
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
      return value !== ALL_VALUE
    }
    return value.trim() !== ""
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
  const [trendRecords, setTrendRecords] = React.useState<OperationRecord[]>([])
  const [statistics, setStatistics] = React.useState<OperationRecordStatistics | null>(null)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalRows, setTotalRows] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

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
      const todayRange = getTodayRange()
      const [list, stats, recent] = await Promise.all([
        operationRecordsApi.list({
          page: nextPage,
          page_size: nextPageSize,
          ...filterParams,
          ...nextSort,
        }),
        operationRecordsApi.getStatistics({
          type: filterParams.type,
          category: filterParams.category,
          start_date: filterParams.start_date || todayRange.start_date,
          end_date: filterParams.end_date || todayRange.end_date,
        }),
        operationRecordsApi.list({
          page: 1,
          page_size: 100,
          ...filterParams,
          ...nextSort,
          ...getLast24HoursRange(),
        }),
      ])
      setRecords(list.records || [])
      setTrendRecords(recent.records || [])
      setPage(list.page || nextPage)
      setTotalPages(list.total_pages || 1)
      setTotalRows(list.total || 0)
      setStatistics(stats)
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
    const nextFilters = { ...filters, type: initialType || ALL_VALUE }
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

  const trend = React.useMemo(() => buildTrend(trendRecords), [trendRecords])
  const connectionTrend = React.useMemo(
    () => buildTrend(trendRecords, (record) => record.type === "connection"),
    [trendRecords]
  )
  const transferTrend = React.useMemo(
    () => buildTrend(trendRecords, (record) => record.type === "transfer"),
    [trendRecords]
  )
  const executionTrend = React.useMemo(
    () => buildTrend(trendRecords, (record) => record.type === "execution"),
    [trendRecords]
  )
  const failureTrend = React.useMemo(
    () => buildTrend(trendRecords, (record) => record.status === "failure"),
    [trendRecords]
  )
  const hasTrendData = trend.some((value) => value > 0)
  const total = statistics?.total || 0
  const byType = statistics?.by_type || EMPTY_BY_TYPE
  const donutItems = React.useMemo<DonutItem[]>(() => {
    const source = Object.keys(byType).length > 0
      ? byType
      : records.reduce<Record<string, number>>((acc, record) => {
          acc[record.type] = (acc[record.type] || 0) + 1
          return acc
        }, {})
    return (["connection", "transfer", "execution", "audit"] as OperationRecordType[]).map((recordType, index) => ({
      label: typeLabels[recordType],
      value: source[recordType] || 0,
      color: ["var(--chart-1)", "var(--chart-4)", "var(--chart-3)", "var(--chart-2)"][index],
    }))
  }, [byType, records, typeLabels])

  const recentExceptions = React.useMemo(() => (
    trendRecords
      .filter((record) => (
        record.status === "failure" ||
        record.status === "partial" ||
        record.status === "canceled" ||
        record.status === "timeout" ||
        record.status === "warning"
      ))
      .slice(0, 5)
      .map((record) => ({
        id: record.id,
        icon: record.status === "partial" || record.status === "warning" ? AlertTriangle : XCircle,
        title: record.title || record.resource || typeLabels[record.type],
        description: `${record.server_name || "-"} / ${record.username || "-"}`,
        time: formatTime(record.started_at || record.created_at),
        tone: statusTone(record.status),
      }))
  ), [trendRecords, typeLabels])

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
    void loadData(1, true, filters, pageSize)
  }

  const handleResetFilters = () => {
    const nextFilters = createDefaultFilters(initialType)
    setFilters(nextFilters)
    setPage(1)
    setSelectedId(null)
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

  const recordColumns = React.useMemo<ColumnDef<OperationRecord>[]>(() => [
    {
      id: "started_at",
      accessorFn: (record) => record.started_at || record.created_at,
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
      header: () => <SortableHeader label={t("columnType")} field="type" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge label={typeLabels[row.original.type]} tone={typeTone(row.original.type)} />
      ),
    },
    {
      id: "category",
      accessorKey: "category",
      header: () => <SortableHeader label={t("columnCategory")} field="category" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge label={categoryLabels[row.original.category]} tone={categoryTone(row.original.category)} />
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: () => <SortableHeader label={t("columnStatus")} field="status" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <InlineStatusBadge label={statusLabels[row.original.status] || row.original.status} tone={statusTone(row.original.status)} />
      ),
    },
    {
      id: "action",
      accessorKey: "action",
      header: () => <SortableHeader label={t("columnAction")} field="action" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => {
        const record = row.original
        const TypeIcon = typeIcon(record.type)
        return (
          <div className="flex min-w-[220px] items-center gap-2">
            <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate font-medium">{record.title || record.resource || record.action}</div>
              <div className="truncate text-xs text-muted-foreground">{record.resource || record.source || "-"}</div>
            </div>
          </div>
        )
      },
    },
    {
      id: "username",
      accessorKey: "username",
      header: () => <SortableHeader label={t("columnUser")} field="username" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => row.original.username || "-",
    },
    {
      id: "server_name",
      accessorKey: "server_name",
      header: () => <SortableHeader label={t("columnServer")} field="server_name" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        <span className="block max-w-[160px] truncate" title={row.original.server_name || undefined}>
          {row.original.server_name || "-"}
        </span>
      ),
    },
    {
      id: "source",
      accessorKey: "source",
      header: () => <SortableHeader label={t("columnSource")} field="source" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{row.original.source || "-"}</span>,
    },
    {
      id: "ip",
      accessorKey: "ip",
      header: () => <SortableHeader label={t("columnIp")} field="ip" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs">{row.original.ip || "-"}</span>,
    },
    {
      id: "progress",
      accessorKey: "progress",
      header: () => <SortableHeader label={t("columnProgress")} field="progress" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => (
        row.original.progress > 0 ? (
          <div className="flex min-w-[110px] items-center gap-2">
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
      header: () => <SortableHeader label={t("columnDuration")} field="duration_ms" sort={sort} onSort={handleSort} />,
      cell: ({ row }) => formatDuration(row.original.duration_ms),
    },
    {
      id: "result",
      accessorFn: (record) => record.error_message || record.detail_json || "",
      header: t("columnResult"),
      cell: ({ row }) => {
        const result = row.original.error_message || row.original.detail_json || row.original.source || "-"
        return (
          <span className="block max-w-[260px] truncate text-muted-foreground" title={result === "-" ? undefined : result}>
            {result}
          </span>
        )
      },
    },
  ], [categoryLabels, handleSort, sort, statusLabels, t, typeLabels])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0 xl:overflow-hidden">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>{t("dashboardDescription")}</p>
        <DashboardStatusLine label={t("systemHealthy")} timestamp={formatDateTime(new Date().toISOString())} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <DashboardMetricCard title={t("metricTodayOps")} value={total} icon={FileText} tone="emerald" spark={trend} loading={loading} />
        <DashboardMetricCard title={t("metricConnections")} value={byType.connection || 0} icon={TerminalSquare} tone="blue" spark={connectionTrend} loading={loading} />
        <DashboardMetricCard title={t("metricTransfers")} value={byType.transfer || 0} icon={Upload} tone="violet" spark={transferTrend} loading={loading} />
        <DashboardMetricCard title={t("metricExecutions")} value={byType.execution || 0} icon={Rocket} tone="amber" spark={executionTrend} loading={loading} />
        <DashboardMetricCard title={t("metricFailures")} value={statistics?.failure_count || 0} icon={AlertTriangle} tone="rose" spark={failureTrend} loading={loading} />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,0.85fr)] xl:overflow-hidden">
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
          className="min-h-[520px] overflow-hidden xl:min-h-0"
          scrollContainerClassName="min-h-[360px]"
          tableClassName="min-w-[1280px]"
          density="compact"
          onRowClick={(record) => setSelectedId(record.id)}
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

        <div className="grid min-h-0 gap-3 overflow-visible xl:overflow-auto">
          <DashboardTrendCard title={t("trendTitle")} label={t("last24Hours")} data={hasTrendData ? trend : []} tone="emerald" emptyLabel={t("empty")} loading={loading} />
          <DashboardDonutCard title={t("typeDistributionTitle")} totalLabel={t("totalLabel")} totalValue={total} items={donutItems} loading={loading} />
          <DashboardSideList title={t("recentExceptionsTitle")} empty={t("empty")} items={recentExceptions} />
          <Card className="gap-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{t("detailTitle")}</h2>
              {selectedRecord && <InlineStatusBadge label={typeLabels[selectedRecord.type]} tone={typeTone(selectedRecord.type)} />}
              {selectedRecord && <span className="font-mono text-xs text-muted-foreground">ID: {selectedRecord.id}</span>}
            </div>
            {selectedRecord ? (
              <div className="mt-4 grid gap-4">
                <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-1">
                  <Detail label={t("columnType")} value={typeLabels[selectedRecord.type]} />
                  <Detail label={t("columnCategory")} value={categoryLabels[selectedRecord.category]} />
                  <Detail label={t("columnStatus")} value={statusLabels[selectedRecord.status] || selectedRecord.status} />
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
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-3 font-mono text-xs text-muted-foreground">
                    {selectedRecord.detail_json || selectedRecord.error_message || selectedRecord.resource || selectedRecord.user_agent || "-"}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-muted-foreground">{t("empty")}</div>
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
  t: (key: string) => string
}) {
  const updateFilter = (key: keyof OperationRecordFilters, value: string) => {
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
          <SelectItem value="success">{t("statusSuccess")}</SelectItem>
          <SelectItem value="failure">{t("statusFailure")}</SelectItem>
          <SelectItem value="partial">{t("statusPartial")}</SelectItem>
          <SelectItem value="canceled">{t("statusCanceled")}</SelectItem>
          <SelectItem value="timeout">{t("statusTimeout")}</SelectItem>
          <SelectItem value="warning">{t("statusWarning")}</SelectItem>
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
