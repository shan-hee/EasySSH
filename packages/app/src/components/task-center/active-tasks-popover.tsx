import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleStop, ExternalLink, ListChecks, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type {
  SubscribeRealtimeEvents,
  TaskCenterApi,
  TaskRunListResponse,
  TaskRunSummary,
} from "@/components/task-center/task-center-contracts"
import { patchTaskRunList, taskRealtimePatchFromEvent } from "@/components/task-center/task-center-realtime"
import { formatTaskTypeLabel } from "@/components/task-center/task-labels"
import { getErrorMessage } from "@/lib/error-utils"
import { cn } from "@/lib/utils"

const ACTIVE_STATUSES = ["queued", "running", "canceling"] as const
const ACTIVE_TASKS_QUERY_KEY = ["header", "active-tasks"] as const

export interface ActiveTasksPopoverProps {
  api: TaskCenterApi
  subscribeEvents?: SubscribeRealtimeEvents | null
  onOpenTask: (runId?: string) => void
  enabled?: boolean
}

export function ActiveTasksPopover({
  api,
  subscribeEvents = null,
  onOpenTask,
  enabled = true,
}: ActiveTasksPopoverProps) {
  const { t } = useTranslation("headerActions")
  const { t: tTask } = useTranslation("taskCenter")
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [cancelingIds, setCancelingIds] = React.useState<Record<string, boolean>>({})

  const activeQuery = useQuery({
    queryKey: ACTIVE_TASKS_QUERY_KEY,
    queryFn: () =>
      api.list({
        status: [...ACTIVE_STATUSES],
        page: 1,
        page_size: 20,
      }),
    enabled,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const count = query.state.data?.runs.length ?? 0
      return count > 0 ? 5_000 : 60_000
    },
  })

  const runs = activeQuery.data?.runs ?? []
  const activeCount = activeQuery.data?.total ?? runs.length

  React.useEffect(() => {
    if (!enabled || !subscribeEvents) return
    let refreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (refreshTimer !== null) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void queryClient.invalidateQueries({ queryKey: ACTIVE_TASKS_QUERY_KEY })
      }, 350)
    }

    const unsubscribe = subscribeEvents((event) => {
      if (!event.type.startsWith("task.")) return
      const patch = taskRealtimePatchFromEvent(event)
      if (!patch || !patch.hasConcreteUpdate || event.type !== "task.updated") {
        scheduleRefresh()
        return
      }
      let found = false
      let statusChanged = false
      queryClient.setQueryData<TaskRunListResponse>(ACTIVE_TASKS_QUERY_KEY, (current) => {
        if (!current) return current
        const result = patchTaskRunList(current, patch)
        found = result.found
        statusChanged = result.statusChanged
        return result.data
      })
      if (!found || statusChanged) {
        scheduleRefresh()
      }
    })

    return () => {
      unsubscribe()
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
    }
  }, [enabled, queryClient, subscribeEvents])

  const handleCancel = React.useCallback(async (run: TaskRunSummary) => {
    if (cancelingIds[run.id]) return
    setCancelingIds((prev) => ({ ...prev, [run.id]: true }))
    try {
      await api.cancel(run.id)
      toast.success(tTask("cancelRequested"))
      await queryClient.invalidateQueries({ queryKey: ACTIVE_TASKS_QUERY_KEY })
    } catch (error) {
      toast.error(getErrorMessage(error, tTask("cancelFailed")))
    } finally {
      setCancelingIds((prev) => {
        const next = { ...prev }
        delete next[run.id]
        return next
      })
    }
  }, [api, cancelingIds, queryClient, tTask])

  const tooltipText = activeCount > 0
    ? t("activeTasksTooltipCount", { count: activeCount, defaultValue: `${activeCount} 个任务正在运行` })
    : t("activeTasksTooltip", { defaultValue: "后台任务" })

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void activeQuery.refetch()
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn("relative", activeCount > 0 && "text-primary")}
              aria-label={tooltipText}
            >
              {activeCount > 0 ? <Loader2 className="animate-spin" /> : <ListChecks />}
              {activeCount > 0 ? (
                <span className="absolute right-0.5 top-0.5 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground tabular-nums">
                  {activeCount > 99 ? "99+" : activeCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipText}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={8} className="w-[min(380px,calc(100vw-24px))] p-0 [--wails-draggable:no-drag]">
        <div className="flex h-11 items-center justify-between gap-2 border-b px-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t("activeTasksTitle", { defaultValue: "运行中的任务" })}</span>
            {activeCount > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                {activeCount}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setOpen(false)
              onOpenTask()
            }}
          >
            {t("activeTasksManage", { defaultValue: "任务管理" })}
            <ExternalLink className="ml-1 size-3" />
          </Button>
        </div>

        <ScrollArea className="max-h-[min(360px,55vh)]">
          {runs.length > 0 ? (
            <div className="divide-y">
              {runs.map((run) => {
                const isCanceling = Boolean(cancelingIds[run.id]) || run.status === "canceling"
                const canCancel = run.cancelable && (run.status === "queued" || run.status === "running")
                return (
                  <div key={run.id} className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/40">
                    <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left outline-none"
                      onClick={() => {
                        setOpen(false)
                        onOpenTask(run.id)
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{run.title}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{run.progress}%</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {formatTaskTypeLabel(run.task_type, tTask)}
                        {run.server_name ? ` · ${run.server_name}` : ""}
                        {run.status === "queued" ? ` · ${tTask("statusQueued")}` : ""}
                        {run.status === "canceling" ? ` · ${tTask("statusCanceling")}` : ""}
                      </div>
                      <Progress value={run.progress} className="mt-1.5 h-1" />
                    </button>
                    {canCancel && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={isCanceling}
                        title={tTask("cancelTask")}
                        aria-label={tTask("cancelTask")}
                        onClick={() => void handleCancel(run)}
                      >
                        {isCanceling ? <Loader2 className="size-3.5 animate-spin" /> : <CircleStop className="size-3.5" />}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {t("activeTasksEmpty", { defaultValue: "当前没有正在运行的后台任务" })}
            </div>
          )}
        </ScrollArea>

        <div className="border-t p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => {
              setOpen(false)
              onOpenTask()
            }}
          >
            {t("notificationsViewAll")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
