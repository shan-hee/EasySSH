import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clock3,
  Filter,
  Inbox,
  Loader2,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { DashboardPageContent } from "@/components/dashboard-page-content"
import { PageHeader } from "@/components/page-header"
import { PageLoading } from "@/components/page-loading"
import { useOptionalClientAuth } from "@/components/client-auth-provider"
import type {
  SubscribeRealtimeEvents,
  TaskCenterApi,
  TaskEvent,
  TaskRun,
  TaskRunListResponse,
  TaskRunStatus,
  TaskStatistics,
} from "@/components/task-center/task-center-contracts"
import { patchTaskRunDetail, patchTaskRunList, taskRealtimePatchFromEvent } from "@/components/task-center/task-center-realtime"
import { TaskInspector } from "@/components/task-center/task-inspector"
import { formatTaskTypeLabel, primaryTaskTypeFilterValues } from "@/components/task-center/task-labels"
import {
  ACTIVE_STATUSES,
  ATTENTION_STATUSES,
  formatRunDuration,
  formatTaskDate,
  formatTaskResourcePreview,
  formatTaskShortTime,
  isTaskActive,
  statusLabelKeys,
  TaskStatusPill,
  TaskTriggerChip,
  TaskTypeAvatar,
} from "@/components/task-center/task-visuals"
import { Button } from "@/components/ui/button"
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSystemConfig } from "@/contexts/system-config-context"
import {
  taskCenterRunsQueryOptions,
  taskCenterStatisticsQueryOptions,
} from "@/lib/dashboard-query-options"
import { getErrorMessage } from "@/lib/error-utils"
import { formatBytesString } from "@/lib/format-utils"
import { queryKeys } from "@/lib/query-keys"
import { DEFAULT_TABLE_PAGE_SIZE, TABLE_PAGE_SIZE_OPTIONS } from "@/lib/table-pagination"
import { cn } from "@/lib/utils"
import { getEffectiveLocale, getEffectiveTimezone } from "@/utils/datetime"

const emptyStatistics: TaskStatistics = {
  total: 0,
  queued: 0,
  running: 0,
  canceling: 0,
  succeeded: 0,
  failed: 0,
  partial_success: 0,
  canceled: 0,
  timeout: 0,
  unknown: 0,
}

const DETAIL_STATUS_FILTERS: TaskRunStatus[] = ["failed", "partial_success", "timeout", "unknown", "canceled"]
const SPLIT_MIN_WIDTH = 360
const SPLIT_MAX_WIDTH = 680
const SPLIT_DEFAULT_WIDTH = 460
const SPLIT_STORAGE_KEY = "easyssh.task-center.list-width"

export interface TaskCenterViewProps {
  api: TaskCenterApi
  subscribeEvents?: SubscribeRealtimeEvents | null
  hidePageHeader?: boolean
  schedulesContent?: ReactNode
  activeTab?: "runs" | "schedules"
  onTabChange?: (tab: "runs" | "schedules") => void
  definitionFilter?: { id: string; name?: string } | null
  onClearDefinitionFilter?: () => void
  onDownloadArtifact?: (run: TaskRun) => Promise<void>
  requestedRunID?: string | null
  onClearRequestedRun?: () => void
}

export function TaskCenterView({
  api,
  subscribeEvents = null,
  hidePageHeader = false,
  schedulesContent,
  activeTab: controlledTab,
  onTabChange,
  definitionFilter = null,
  onClearDefinitionFilter,
  onDownloadArtifact,
  requestedRunID: externalRequestedRunID,
  onClearRequestedRun,
}: TaskCenterViewProps) {
  const { t, i18n } = useTranslation("taskCenter")
  const clientAuth = useOptionalClientAuth()
  const { config: systemConfig } = useSystemConfig()
  const effectiveLocale = useMemo<"zh-CN" | "en-US">(() => {
    const resolved = clientAuth?.user || systemConfig?.default_language
      ? getEffectiveLocale(clientAuth?.user ?? null, systemConfig ?? null)
      : i18n.language
    return resolved === "en-US" ? "en-US" : "zh-CN"
  }, [clientAuth?.user, i18n.language, systemConfig])
  const effectiveTimezone = useMemo(
    () => getEffectiveTimezone(clientAuth?.user ?? null, systemConfig ?? null),
    [clientAuth?.user, systemConfig],
  )
  const queryClient = useQueryClient()
  const isWideSplit = useMediaQuery("(min-width: 1024px)")
  const split = useSplitListWidth()

  const [uncontrolledTab, setUncontrolledTab] = useState<"runs" | "schedules">("runs")
  const currentTab = controlledTab ?? uncontrolledTab
  const handleTabChange = useCallback((value: string) => {
    const next = value === "schedules" ? "schedules" : "runs"
    if (controlledTab === undefined) setUncontrolledTab(next)
    onTabChange?.(next)
  }, [controlledTab, onTabChange])

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_TABLE_PAGE_SIZE)
  const [statusFilter, setStatusFilter] = useState("all")
  const [excludeMicro, setExcludeMicro] = useState(true)
  const [taskTypeFilters, setTaskTypeFilters] = useState<string[]>([])
  const [triggerFilters, setTriggerFilters] = useState<TaskRun["trigger_type"][]>([])
  const [keyword, setKeyword] = useState("")
  const deferredKeyword = useDeferredValue(keyword.trim())
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const selectedRunIdRef = useRef<string | null>(null)
  const [pendingActions, setPendingActions] = useState<Record<string, "cancel" | "retry">>({})
  const pendingActionsRef = useRef<Record<string, "cancel" | "retry">>({})
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const handledRequestedRunRef = useRef<string | null>(null)

  const listParams = useMemo(() => {
    const status = statusFilter === "active"
      ? ACTIVE_STATUSES
      : statusFilter === "attention"
        ? ATTENTION_STATUSES
        : statusFilter === "all"
          ? undefined
          : [statusFilter as TaskRunStatus]
    const shouldExcludeMicro = excludeMicro && taskTypeFilters.length === 0
    return {
      ...(status ? { status } : {}),
      ...(taskTypeFilters.length > 0 ? { task_type: taskTypeFilters } : {}),
      ...(triggerFilters.length > 0 ? { trigger_type: triggerFilters } : {}),
      ...(definitionFilter?.id ? { definition_id: definitionFilter.id } : {}),
      ...(shouldExcludeMicro ? { exclude_micro: true } : {}),
      ...(deferredKeyword ? { keyword: deferredKeyword } : {}),
      page,
      page_size: pageSize,
    }
  }, [deferredKeyword, definitionFilter?.id, excludeMicro, page, pageSize, statusFilter, taskTypeFilters, triggerFilters])

  const runsQuery = useQuery({
    ...taskCenterRunsQueryOptions(listParams, api),
    refetchInterval: 60_000,
  })
  const statisticsQuery = useQuery({
    ...taskCenterStatisticsQueryOptions(api),
    refetchInterval: 60_000,
  })

  const runs = runsQuery.data?.runs ?? []
  const totalPages = Math.max(1, runsQuery.data?.total_pages ?? 1)
  const totalRuns = runsQuery.data?.total ?? 0
  const statistics = statisticsQuery.data ?? emptyStatistics
  const loading = runsQuery.isPending || statisticsQuery.isPending
  const refreshing = (
    (runsQuery.isFetching && !runsQuery.isPending) ||
    (statisticsQuery.isFetching && !statisticsQuery.isPending)
  )

  // 宽屏分栏模式下，首次进入自动高亮第一条任务，让右侧实时检查器开箱即用；窄屏保持关闭避免误弹抽屉。
  const effectiveSelectedRunId = useMemo(() => {
    if (selectedRunId) return selectedRunId
    if (isWideSplit && !inspectorCollapsed && runs.length > 0) {
      return runs[0].id
    }
    return null
  }, [inspectorCollapsed, isWideSplit, runs, selectedRunId])

  const detailQuery = useQuery({
    queryKey: queryKeys.taskCenter.detail(effectiveSelectedRunId ?? "none"),
    queryFn: async () => {
      const id = effectiveSelectedRunId as string
      const next = await api.get(id)
      const previous = queryClient.getQueryData<Awaited<ReturnType<TaskCenterApi["get"]>>>(queryKeys.taskCenter.detail(id))
      if (!previous?.eventPage || !next.eventPage || previous.eventPage.next_after_id <= next.eventPage.next_after_id) {
        return next
      }
      const freshById = new Map(next.events.map((event) => [event.id, event]))
      let mergedEvents = previous.events.map((event) => freshById.get(event.id) ?? event)
      let eventPage = { ...previous.eventPage }
      if (api.events) {
        try {
          const tail = await api.events(id, previous.eventPage.next_after_id)
          const existingIds = new Set(mergedEvents.map((event) => event.id))
          const appended = tail.events.filter((event) => !existingIds.has(event.id))
          if (appended.length > 0) {
            mergedEvents = [...mergedEvents, ...appended]
          }
          eventPage = {
            ...tail,
            events: mergedEvents,
            next_after_id: tail.next_after_id || previous.eventPage.next_after_id,
          }
        } catch {
          // 保留已有分页事件。
        }
      }
      return { ...next, events: mergedEvents, eventPage }
    },
    enabled: effectiveSelectedRunId !== null && (isWideSplit ? !inspectorCollapsed : selectedRunId !== null),
    refetchInterval: (query) => query.state.data && ACTIVE_STATUSES.includes(query.state.data.run.status) ? 2500 : false,
    staleTime: 0,
  })
  const selected = detailQuery.data ?? null

  const refetchRuns = runsQuery.refetch
  const refetchStatistics = statisticsQuery.refetch
  const refetchAll = useCallback(async () => {
    await Promise.all([refetchRuns(), refetchStatistics()])
  }, [refetchRuns, refetchStatistics])

  useEffect(() => {
    if (page > totalPages && !runsQuery.isPlaceholderData) setPage(totalPages)
  }, [page, runsQuery.isPlaceholderData, totalPages])

  useEffect(() => {
    selectedRunIdRef.current = effectiveSelectedRunId
  }, [effectiveSelectedRunId])

  useEffect(() => {
    const error = !runsQuery.data
      ? runsQuery.error
      : !statisticsQuery.data
        ? statisticsQuery.error
        : null
    if (!error) return
    toast.error(getErrorMessage(error, t("loadFailed")))
  }, [runsQuery.data, runsQuery.error, statisticsQuery.data, statisticsQuery.error, t])

  useEffect(() => {
    if (!subscribeEvents) return
    let authoritativeRefreshTimer: number | null = null
    let detailRefreshTimer: number | null = null
    let detailRefreshTaskId: string | null = null

    const scheduleAuthoritativeRefresh = () => {
      if (authoritativeRefreshTimer !== null) return
      authoritativeRefreshTimer = window.setTimeout(() => {
        authoritativeRefreshTimer = null
        void refetchAll()
      }, 500)
    }

    const scheduleDetailRefresh = (taskId: string) => {
      if (selectedRunIdRef.current !== taskId) return
      if (detailRefreshTimer !== null && detailRefreshTaskId === taskId) return
      if (detailRefreshTimer !== null) window.clearTimeout(detailRefreshTimer)
      detailRefreshTaskId = taskId
      detailRefreshTimer = window.setTimeout(() => {
        detailRefreshTimer = null
        detailRefreshTaskId = null
        void queryClient.invalidateQueries({
          queryKey: queryKeys.taskCenter.detail(taskId),
        })
      }, 750)
    }

    const unsubscribe = subscribeEvents((event) => {
      if (!event.type.startsWith("task.")) return
      const patch = taskRealtimePatchFromEvent(event)
      if (!patch || !patch.hasConcreteUpdate || event.type !== "task.updated") {
        if (patch?.taskId) scheduleDetailRefresh(patch.taskId)
        scheduleAuthoritativeRefresh()
        return
      }
      const taskId = patch.taskId

      let foundCachedRun = false
      let statusChanged = false
      queryClient.setQueriesData<TaskRunListResponse>(
        { queryKey: ["task-center", "runs"] },
        (current) => {
          if (!current) return current
          const result = patchTaskRunList(current, patch)
          foundCachedRun = foundCachedRun || result.found
          statusChanged = statusChanged || result.statusChanged
          return result.data
        },
      )

      queryClient.setQueryData<{ run: TaskRun; events: TaskEvent[] }>(
        queryKeys.taskCenter.detail(taskId),
        (current) => current ? patchTaskRunDetail(current, patch) : current,
      )

      scheduleDetailRefresh(taskId)
      if (!foundCachedRun || statusChanged) scheduleAuthoritativeRefresh()
    })
    return () => {
      unsubscribe()
      if (authoritativeRefreshTimer !== null) window.clearTimeout(authoritativeRefreshTimer)
      if (detailRefreshTimer !== null) window.clearTimeout(detailRefreshTimer)
    }
  }, [queryClient, refetchAll, subscribeEvents])

  const openDetails = useCallback((runId: string) => {
    setSelectedRunId(runId)
    setInspectorCollapsed(false)
  }, [])

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
    setSelectedRunId(requestedRunID)
    setInspectorCollapsed(false)
  }, [requestedRunID])

  useEffect(() => {
    if (!detailQuery.error || detailQuery.data) return
    toast.error(getErrorMessage(detailQuery.error, t("detailsLoadFailed")))
    setSelectedRunId(null)
    clearRequestedRun()
  }, [clearRequestedRun, detailQuery.data, detailQuery.error, t])

  const runAction = useCallback(async (action: "cancel" | "retry", run: TaskRun) => {
    if (pendingActionsRef.current[run.id]) return
    pendingActionsRef.current = { ...pendingActionsRef.current, [run.id]: action }
    setPendingActions(pendingActionsRef.current)
    try {
      const result = action === "cancel"
        ? await api.cancel(run.id)
        : await api.retry(run.id)
      toast.success(t(action === "cancel" ? "cancelRequested" : "retrySubmitted"))
      await queryClient.invalidateQueries({ queryKey: queryKeys.taskCenter.root })
      if (action === "retry" && "retry_of_id" in result && result.id) {
        setSelectedRunId(result.id)
        setInspectorCollapsed(false)
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t(action === "cancel" ? "cancelFailed" : "retryFailed")))
    } finally {
      const next = { ...pendingActionsRef.current }
      delete next[run.id]
      pendingActionsRef.current = next
      setPendingActions(next)
    }
  }, [api, queryClient, t])

  const handleDownloadArtifact = useCallback(async (run: TaskRun) => {
    if (!onDownloadArtifact || downloadingArtifactId) return
    setDownloadingArtifactId(run.id)
    try {
      await onDownloadArtifact(run)
    } catch (error) {
      toast.error(getErrorMessage(error, t("downloadArtifactFailed")))
    } finally {
      setDownloadingArtifactId(null)
    }
  }, [downloadingArtifactId, onDownloadArtifact, t])

  const handleLoadMoreEvents = useCallback(() => {
    if (!selected || !api.events || !selected.eventPage || loadingEvents) return
    const id = selected.run.id
    setLoadingEvents(true)
    void api.events(id, selected.eventPage.next_after_id)
      .then((nextPage) => {
        queryClient.setQueryData<Awaited<ReturnType<TaskCenterApi["get"]>>>(
          queryKeys.taskCenter.detail(id),
          (current) => current
            ? {
                ...current,
                events: [
                  ...current.events,
                  ...nextPage.events.filter((e) => !current.events.some((old) => old.id === e.id)),
                ],
                eventPage: nextPage,
              }
            : current,
        )
      })
      .catch((error) => toast.error(getErrorMessage(error, t("loadFailed"))))
      .finally(() => setLoadingEvents(false))
  }, [api, loadingEvents, queryClient, selected, t])

  const formatTimestamp = useCallback(
    (value: string | undefined) => formatTaskDate(value, effectiveLocale, effectiveTimezone),
    [effectiveLocale, effectiveTimezone],
  )
  const formatShortTimestamp = useCallback(
    (value: string | undefined) => formatTaskShortTime(value, effectiveLocale, effectiveTimezone),
    [effectiveLocale, effectiveTimezone],
  )

  const activeCount = statistics.running + statistics.queued + statistics.canceling
  const attentionCount = statistics.failed + statistics.partial_success + statistics.timeout + statistics.unknown
  const finishedCount = statistics.succeeded + attentionCount + statistics.canceled
  const successRate = finishedCount > 0 ? Math.round((statistics.succeeded / finishedCount) * 100) : null
  const otherAttentionCount = statistics.partial_success + statistics.timeout + statistics.unknown

  const hasActiveFilters = Boolean(
    statusFilter !== "all" ||
    keyword.trim() ||
    taskTypeFilters.length > 0 ||
    triggerFilters.length > 0 ||
    definitionFilter,
  )

  const resetAllFilters = useCallback(() => {
    setPage(1)
    setStatusFilter("all")
    setKeyword("")
    setTaskTypeFilters([])
    setTriggerFilters([])
    onClearDefinitionFilter?.()
  }, [onClearDefinitionFilter])

  const kpiCards = useMemo(() => [
    {
      filter: "all",
      label: t("metricAll"),
      value: statistics.total,
      subtitle: t("metricAllSub"),
      icon: Clock3,
      iconBg: "bg-muted text-muted-foreground",
      valueClass: "",
      pulse: false,
    },
    {
      filter: "active",
      label: t("metricActive"),
      value: activeCount,
      subtitle: activeCount > 0 ? t("metricActiveSub") : t("noActiveTasks"),
      icon: activeCount > 0 ? Loader2 : Activity,
      iconBg: activeCount > 0
        ? "bg-sky-500/12 text-sky-600 dark:text-sky-400"
        : "bg-muted text-muted-foreground",
      valueClass: activeCount > 0 ? "text-sky-600 dark:text-sky-400" : "",
      pulse: activeCount > 0,
    },
    {
      filter: "attention",
      label: t("metricAttention"),
      value: attentionCount,
      subtitle: attentionCount > 0
        ? t("metricAttentionBreakdown", { failed: statistics.failed, other: otherAttentionCount })
        : t("allHealthy"),
      icon: AlertTriangle,
      iconBg: attentionCount > 0
        ? "bg-destructive/12 text-destructive"
        : "bg-muted text-muted-foreground",
      valueClass: attentionCount > 0 ? "text-destructive" : "",
      pulse: false,
    },
    {
      filter: "succeeded",
      label: t("metricSucceeded"),
      value: statistics.succeeded,
      subtitle: successRate !== null ? t("metricSuccessRate", { rate: successRate }) : "—",
      icon: CheckCircle2,
      iconBg: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
      valueClass: "",
      pulse: false,
    },
  ], [activeCount, attentionCount, otherAttentionCount, statistics.failed, statistics.succeeded, statistics.total, successRate, t])

  const detailStatusSelected = DETAIL_STATUS_FILTERS.includes(statusFilter as TaskRunStatus)
    ? (statusFilter as TaskRunStatus)
    : ""

  const renderInspectorPanel = (onClose?: () => void) => {
    if (!effectiveSelectedRunId) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground">
            <Inbox className="size-5" />
          </div>
          <div className="max-w-xs space-y-1">
            <p className="text-sm font-medium text-foreground">{t("inspectorEmptyTitle")}</p>
            <p className="text-xs leading-5 text-muted-foreground">{t("inspectorEmptyDescription")}</p>
          </div>
        </div>
      )
    }

    if (detailQuery.isError) {
      return (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
          <p className="text-destructive">{getErrorMessage(detailQuery.error, t("loadFailed"))}</p>
          <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
            {t("refresh")}
          </Button>
        </div>
      )
    }

    if (!selected) {
      return <PageLoading className="min-h-56 flex-1" />
    }

    const canDownload = Boolean(
      onDownloadArtifact &&
      selected.run.task_type === "sftp_download" &&
      selected.run.status === "succeeded" &&
      selected.run.source_type === "transfer_job" &&
      selected.run.source_id,
    )

    return (
      <TaskInspector
        run={selected.run}
        events={selected.events}
        moreEvents={selected.eventPage?.has_more}
        loadingEvents={loadingEvents}
        loadMore={handleLoadMoreEvents}
        pendingAction={pendingActions[selected.run.id]}
        downloadingArtifact={downloadingArtifactId === selected.run.id}
        onDownloadArtifact={canDownload ? () => void handleDownloadArtifact(selected.run) : undefined}
        onAction={runAction}
        onRefresh={() => void detailQuery.refetch()}
        refreshing={detailQuery.isFetching && !detailQuery.isPending}
        onClose={onClose}
        t={t}
        formatTimestamp={formatTimestamp}
      />
    )
  }

  const runsContent = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 顶部 4 张卡片化 KPI 概览 */}
      <div className="grid shrink-0 grid-cols-2 gap-2.5 lg:grid-cols-4">
        {kpiCards.map(({ filter, label, value, subtitle, icon: Icon, iconBg, valueClass, pulse }) => {
          const active = statusFilter === filter
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setPage(1)
                setStatusFilter(filter)
              }}
              className={cn(
                "group relative flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-all hover:border-foreground/20 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active && "border-primary/45 bg-primary/[0.03] ring-1 ring-primary/15",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("truncate", active && "font-medium text-foreground")}>{label}</span>
                  {pulse ? (
                    <span className="relative flex size-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
                    </span>
                  ) : null}
                </div>
                <div className={cn("mt-1 text-2xl font-semibold leading-none tracking-tight tabular-nums", valueClass)}>
                  {value.toLocaleString()}
                </div>
                <div className="mt-1.5 truncate text-[11px] text-muted-foreground">
                  {subtitle}
                </div>
              </div>
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105", iconBg)}>
                <Icon className={cn("size-4", pulse && "animate-spin")} />
              </div>
            </button>
          )
        })}
      </div>

      {/* 活态运行置顶条（仅当存在后台运行任务且不在“运行中”视图时提示） */}
      {activeCount > 0 && statusFilter !== "active" ? (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-3.5 py-2 text-xs">
          <div className="flex min-w-0 items-center gap-2 text-sky-800 dark:text-sky-200">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
            <span className="truncate font-medium">
              {t("activeBannerMessage", { count: activeCount })}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-500/15 hover:text-sky-800 dark:text-sky-300"
            onClick={() => {
              setPage(1)
              setStatusFilter("active")
            }}
          >
            {t("activeBannerAction")}
          </Button>
        </div>
      ) : null}

      {/* 主工作区：宽屏左右 Master-Detail 分栏，窄屏单列列表 + 右侧滑出 Sheet */}
      <div
        ref={split.container}
        className="flex min-h-[420px] flex-1 overflow-hidden rounded-xl border bg-card lg:min-h-0"
        style={{ "--task-list-width": `${split.width}px` } as CSSProperties}
      >
        {/* 左栏：筛选头 + 高密度任务流 + 底部分页 */}
        <section
          className={cn(
            "relative flex min-h-0 min-w-0 flex-col",
            isWideSplit && !inspectorCollapsed
              ? "w-full shrink-0 border-r lg:w-[var(--task-list-width)]"
              : "flex-1",
          )}
        >
          {/* 精简两层筛选栏 */}
          <div className="shrink-0 space-y-2 border-b bg-muted/15 px-3 py-2.5">
            {/* 第一行：4 段主状态胶囊 + 细分状态下拉 + 刷新/降噪/展开检查器 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="inline-flex items-center rounded-lg bg-muted/70 p-0.5">
                  {([
                    { value: "all", label: t("filterAll") },
                    { value: "active", label: t("filterActive"), count: activeCount, tone: "primary" as const },
                    { value: "attention", label: t("filterAttention"), count: attentionCount, tone: "danger" as const },
                    { value: "succeeded", label: t("filterSucceeded") },
                  ]).map((item) => {
                    const active = statusFilter === item.value
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          setPage(1)
                          setStatusFilter(item.value)
                        }}
                        className={cn(
                          "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all",
                          active
                            ? "bg-background text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span>{item.label}</span>
                        {item.count && item.count > 0 ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.25 text-[10px] font-semibold tabular-nums",
                              item.tone === "danger"
                                ? "bg-destructive/15 text-destructive"
                                : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
                            )}
                          >
                            {item.count}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant={detailStatusSelected ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground data-[state=open]:bg-muted"
                    >
                      <SlidersHorizontal className="size-3" />
                      <span>
                        {detailStatusSelected
                          ? t(statusLabelKeys[detailStatusSelected])
                          : t("statusMorePlaceholder")}
                      </span>
                      <ChevronDown className="size-3 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    <DropdownMenuRadioGroup
                      value={detailStatusSelected}
                      onValueChange={(value) => {
                        setPage(1)
                        setStatusFilter(value || "all")
                      }}
                    >
                      {DETAIL_STATUS_FILTERS.map((status) => (
                        <DropdownMenuRadioItem key={status} value={status} className="text-xs">
                          {t(statusLabelKeys[status])}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-center gap-1">
                {taskTypeFilters.length === 0 ? (
                  <Button
                    type="button"
                    variant={excludeMicro ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    aria-pressed={excludeMicro}
                    onClick={() => {
                      setPage(1)
                      setExcludeMicro((prev) => !prev)
                    }}
                  >
                    <Filter className="size-3" />
                    <span className="hidden sm:inline">{excludeMicro ? t("hideMicroTasks") : t("showMicroTasks")}</span>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 text-muted-foreground"
                  disabled={refreshing}
                  title={t("refresh")}
                  aria-label={t("refresh")}
                  onClick={() => void refetchAll()}
                >
                  <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
                </Button>
                {isWideSplit && inspectorCollapsed ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-7"
                    title={t("inspectorOpen")}
                    aria-label={t("inspectorOpen")}
                    onClick={() => setInspectorCollapsed(false)}
                  >
                    <PanelRightOpen className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>

            {/* 第二行：搜索 + 类型/来源多选筛选 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative min-w-[160px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(event) => {
                    setPage(1)
                    setKeyword(event.target.value)
                  }}
                  placeholder={t("searchPlaceholder")}
                  className="h-8 bg-background pl-8 pr-7 text-xs"
                />
                {keyword ? (
                  <button
                    type="button"
                    aria-label={t("clearFilter")}
                    onClick={() => {
                      setPage(1)
                      setKeyword("")
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <DataTableFacetedFilter
                title={t("typeFilterPlaceholder")}
                options={primaryTaskTypeFilterValues.map((value) => ({ value, label: formatTaskTypeLabel(value, t) }))}
                values={taskTypeFilters}
                onValuesChange={(values) => {
                  setPage(1)
                  setTaskTypeFilters(values)
                }}
              />
              <DataTableFacetedFilter
                title={t("triggerFilterPlaceholder")}
                options={[
                  { value: "manual", label: t("triggerManual") },
                  { value: "scheduled", label: t("triggerScheduled") },
                  { value: "api", label: t("triggerApi") },
                  { value: "system", label: t("triggerSystem") },
                ]}
                values={triggerFilters}
                onValuesChange={(values) => {
                  setPage(1)
                  setTriggerFilters(values as TaskRun["trigger_type"][])
                }}
              />
              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={resetAllFilters}
                >
                  <X className="mr-1 size-3" />
                  {t("resetFilters")}
                </Button>
              ) : null}
            </div>

            {definitionFilter ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs">
                <span className="truncate text-muted-foreground">
                  {t("definitionFilterLabel")}:{" "}
                  <strong className="font-medium text-foreground">{definitionFilter.name || definitionFilter.id}</strong>
                </span>
                {onClearDefinitionFilter ? (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearDefinitionFilter}>
                    <X className="mr-1 size-3" />
                    {t("clearFilter")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 任务流主列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && runs.length === 0 ? (
              <PageLoading className="min-h-56" />
            ) : runs.length === 0 ? (
              <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground">
                  <Inbox className="size-5" />
                </div>
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
                {hasActiveFilters ? (
                  <Button type="button" variant="outline" size="sm" onClick={resetAllFilters}>
                    {t("resetFilters")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {runs.map((run) => {
                  const active = isTaskActive(run.status)
                  const isSelected = effectiveSelectedRunId === run.id && (!isWideSplit || !inspectorCollapsed)
                  const duration = formatRunDuration(run.started_at, run.finished_at)
                  const hasBytes = run.bytes_total > 0 || run.bytes_processed > 0
                  const pendingAction = pendingActions[run.id]
                  const canCancel = run.cancelable && (run.status === "queued" || run.status === "running")
                  const canRetry = run.retryable && ["failed", "partial_success", "canceled", "timeout"].includes(run.status)

                  return (
                    <div
                      key={run.id}
                      role="button"
                      tabIndex={0}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => openDetails(run.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          openDetails(run.id)
                        }
                      }}
                      className={cn(
                        "group relative flex cursor-pointer items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/50 focus-visible:outline-none",
                        isSelected && "bg-primary/[0.055] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
                      )}
                    >
                      <TaskTypeAvatar taskType={run.task_type} active={active} size="md" />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                            {run.title}
                          </span>
                          <TaskTriggerChip trigger={run.trigger_type} t={t} subtleManual />
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="max-w-[220px] truncate">{formatTaskResourcePreview(run, t)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatTaskTypeLabel(run.task_type, t)}</span>
                          {duration ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">{duration}</span>
                            </>
                          ) : null}
                          {hasBytes ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                {formatBytesString(run.bytes_total > 0 ? run.bytes_total : run.bytes_processed)}
                              </span>
                            </>
                          ) : run.total_count > 1 ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                {t("targetsProgress", { success: run.success_count, total: run.total_count })}
                              </span>
                            </>
                          ) : null}
                        </div>

                        {active ? (
                          <div className="mt-1.5 flex items-center gap-2">
                            <Progress value={run.progress} className="h-1 flex-1" />
                            <span className="w-8 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                              {run.progress}%
                            </span>
                          </div>
                        ) : run.error_message ? (
                          <p className="mt-1 truncate text-[11px] text-destructive/90" title={run.error_message}>
                            {run.error_message}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1">
                          {canCancel ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="size-6 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                              disabled={Boolean(pendingAction)}
                              title={t("cancelTask")}
                              aria-label={t("cancelTask")}
                              onClick={(event) => {
                                event.stopPropagation()
                                void runAction("cancel", run)
                              }}
                            >
                              {pendingAction === "cancel" ? <Loader2 className="size-3 animate-spin" /> : <CircleStop className="size-3.5" />}
                            </Button>
                          ) : canRetry ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="size-6 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                              disabled={Boolean(pendingAction)}
                              title={t("retryTask")}
                              aria-label={t("retryTask")}
                              onClick={(event) => {
                                event.stopPropagation()
                                void runAction("retry", run)
                              }}
                            >
                              {pendingAction === "retry" ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3.5" />}
                            </Button>
                          ) : null}
                          <TaskStatusPill status={run.status} t={t} compact />
                        </div>
                        <time
                          dateTime={run.created_at}
                          title={formatTimestamp(run.created_at)}
                          className="text-[11px] tabular-nums text-muted-foreground"
                        >
                          {formatShortTimestamp(run.created_at)}
                        </time>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 底部分页条 */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{t("paginationTotal", { count: totalRuns })}</span>
            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPage(1)
                  setPageSize(Number(value))
                }}
              >
                <SelectTrigger size="sm" className="h-7 w-[72px] bg-background text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)} className="text-xs">
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="whitespace-nowrap tabular-nums">
                {t("paginationPage", { page, total: totalPages })}
              </span>
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-7"
                  disabled={page <= 1}
                  title={t("previousPage")}
                  aria-label={t("previousPage")}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-7"
                  disabled={page >= totalPages}
                  title={t("nextPage")}
                  aria-label={t("nextPage")}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* 宽屏可拖拽分栏手柄 */}
          {isWideSplit && !inspectorCollapsed ? (
            <div
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              aria-label={t("resizeSplitPane")}
              aria-valuemin={SPLIT_MIN_WIDTH}
              aria-valuemax={SPLIT_MAX_WIDTH}
              aria-valuenow={split.width}
              className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize touch-none transition-colors hover:bg-primary/20 focus-visible:bg-primary/25 focus-visible:outline-none lg:block"
              {...split.handle}
            />
          ) : null}
        </section>

        {/* 右栏：宽屏常驻实时检查器 */}
        {isWideSplit && !inspectorCollapsed ? (
          <aside className="hidden min-h-0 min-w-0 flex-1 flex-col lg:flex">
            {renderInspectorPanel(() => setInspectorCollapsed(true))}
          </aside>
        ) : null}
      </div>
    </div>
  )

  return (
    <>
      {!hidePageHeader ? <PageHeader title={t("title")} /> : null}
      <DashboardPageContent className="min-h-0 gap-3">
        {schedulesContent ? (
          <Tabs value={currentTab} onValueChange={handleTabChange} className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="runs" className="gap-1.5">
                  <span>{t("runsTab")}</span>
                  {activeCount > 0 ? (
                    <span className="rounded-full bg-sky-500/15 px-1.5 py-0.25 text-[10px] font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                      {activeCount}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="schedules">{t("schedulesTab")}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="runs" className="mt-3 min-h-0 flex-1 flex-col data-[state=active]:flex">
              {runsContent}
            </TabsContent>

            <TabsContent value="schedules" className="mt-3 min-h-0 flex-1 flex-col overflow-y-auto data-[state=active]:flex">
              {schedulesContent}
            </TabsContent>
          </Tabs>
        ) : (
          runsContent
        )}
      </DashboardPageContent>

      {/* 窄屏自动切换为右侧滑出抽屉，不遮挡居中弹窗 */}
      <Sheet
        open={!isWideSplit && selectedRunId !== null}
        onOpenChange={(open) => {
          if (open) return
          setSelectedRunId(null)
          clearRequestedRun()
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="flex w-[min(640px,96vw)] flex-col gap-0 p-0 sm:max-w-2xl"
        >
          <SheetTitle className="sr-only">{selected?.run.title || t("viewDetails")}</SheetTitle>
          <SheetDescription className="sr-only">
            {selected ? formatTaskResourcePreview(selected.run, t) : t("loading")}
          </SheetDescription>
          {renderInspectorPanel(() => {
            setSelectedRunId(null)
            clearRequestedRun()
          })}
        </SheetContent>
      </Sheet>
    </>
  )
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [query])

  return matches
}

function useSplitListWidth() {
  const container = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; width: number } | null>(null)
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return SPLIT_DEFAULT_WIDTH
    const saved = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY))
    return saved >= SPLIT_MIN_WIDTH && saved <= SPLIT_MAX_WIDTH ? saved : SPLIT_DEFAULT_WIDTH
  })

  const clamp = (value: number) => {
    const containerWidth = container.current?.clientWidth ?? Infinity
    const maxForContainer = Number.isFinite(containerWidth)
      ? Math.max(SPLIT_MIN_WIDTH, containerWidth - 400)
      : SPLIT_MAX_WIDTH
    return Math.round(Math.max(SPLIT_MIN_WIDTH, Math.min(SPLIT_MAX_WIDTH, maxForContainer, value)))
  }

  const commit = (value: number) => {
    setWidth(value)
    try {
      window.localStorage.setItem(SPLIT_STORAGE_KEY, String(value))
    } catch {
      // ignore storage errors
    }
  }

  const handle = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      start.current = { x: event.clientX, width }
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (start.current) setWidth(clamp(start.current.width + event.clientX - start.current.x))
    },
    onPointerUp: () => {
      if (!start.current) return
      start.current = null
      commit(width)
    },
    onPointerCancel: () => {
      start.current = null
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0
      if (!step) return
      event.preventDefault()
      commit(clamp(width + step))
    },
  }

  return { container, width, handle }
}
