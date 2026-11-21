import { useState, type ReactNode } from "react"
import type { TFunction } from "i18next"
import {
  AlertCircle,
  Check,
  CircleStop,
  Copy,
  Download,
  Loader2,
  PanelRightClose,
  RefreshCw,
  RotateCcw,
} from "lucide-react"

import { ExecutionResult } from "@/components/task-center/execution-result"
import type { TaskEvent, TaskRun } from "@/components/task-center/task-center-contracts"
import { formatTaskTypeLabel } from "@/components/task-center/task-labels"
import {
  formatRunDuration,
  formatTaskResourcePreview,
  isTaskActive,
  TaskStatusPill,
  TaskTriggerChip,
  TaskTypeAvatar,
} from "@/components/task-center/task-visuals"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatBytesString } from "@/lib/format-utils"
import { cn } from "@/lib/utils"

export interface TaskInspectorProps {
  run: TaskRun
  events: TaskEvent[]
  moreEvents?: boolean
  loadingEvents?: boolean
  loadMore: () => void
  pendingAction?: "cancel" | "retry"
  downloadingArtifact?: boolean
  onDownloadArtifact?: () => void
  onAction: (action: "cancel" | "retry", run: TaskRun) => void
  onRefresh?: () => void
  refreshing?: boolean
  onClose?: () => void
  t: TFunction
  formatTimestamp: (value: string | undefined) => string
}

export function TaskInspector({
  run,
  events,
  moreEvents,
  loadingEvents,
  loadMore,
  pendingAction,
  downloadingArtifact,
  onDownloadArtifact,
  onAction,
  onRefresh,
  refreshing,
  onClose,
  t,
  formatTimestamp,
}: TaskInspectorProps) {
  const [copiedId, setCopiedId] = useState(false)
  const active = isTaskActive(run.status)
  const duration = formatRunDuration(run.started_at, run.finished_at)
  const hasBytes = run.bytes_total > 0 || run.bytes_processed > 0
  const canCancel = run.cancelable && (run.status === "queued" || run.status === "running")
  const canRetry = run.retryable && ["failed", "partial_success", "canceled", "timeout"].includes(run.status)
  const hasFooterActions = Boolean(onDownloadArtifact || canCancel || canRetry)

  const handleCopyId = () => {
    void navigator.clipboard?.writeText(run.id).then(() => {
      setCopiedId(true)
      window.setTimeout(() => setCopiedId(false), 1500)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      {/* 顶部固定头：类型图标 + 标题/资源 + 状态 + 实时进度条 */}
      <div className="shrink-0 border-b bg-card/95 px-4 py-3.5 sm:px-5">
        <div className="flex items-start gap-3">
          <TaskTypeAvatar taskType={run.task_type} active={active} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold text-foreground sm:text-base" title={run.title}>
                {run.title}
              </h2>
              <TaskStatusPill status={run.status} t={t} compact />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="truncate">{formatTaskResourcePreview(run, t)}</span>
              <span aria-hidden="true">·</span>
              <TaskTriggerChip trigger={run.trigger_type} t={t} />
              <button
                type="button"
                onClick={handleCopyId}
                title={t("copyTaskId")}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span>{run.id.slice(0, 8)}</span>
                {copiedId ? <Check className="size-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-2.5" />}
              </button>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onRefresh ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground"
                disabled={refreshing}
                title={t("refresh")}
                aria-label={t("refresh")}
                onClick={onRefresh}
              >
                <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              </Button>
            ) : null}
            {onClose ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground"
                title={t("inspectorClose")}
                aria-label={t("inspectorClose")}
                onClick={onClose}
              >
                <PanelRightClose className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>

        {active ? (
          <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium text-sky-700 dark:text-sky-300">
                {run.stage ? `${formatTaskTypeLabel(run.task_type, t)} · ${run.stage}` : formatTaskTypeLabel(run.task_type, t)}
              </span>
              <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-sky-700 dark:text-sky-300">
                {run.progress}%
              </span>
            </div>
            <Progress value={run.progress} className="mt-1.5 h-1.5" />
          </div>
        ) : null}
      </div>

      {/* 中间可滚动检查区 */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
        {run.description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{run.description}</p>
        ) : null}

        {run.error_message ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3.5 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              {run.error_code ? (
                <div className="font-mono text-[11px] font-semibold uppercase tracking-wide opacity-85">
                  {run.error_code}
                </div>
              ) : null}
              <p className="break-words leading-5">{run.error_message}</p>
            </div>
          </div>
        ) : null}

        {/* 紧凑指标表面卡片网格 */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MetaTile label={t("detailType")}>{formatTaskTypeLabel(run.task_type, t)}</MetaTile>
          <MetaTile label={t("detailDuration")}>
            <span className="tabular-nums">{duration || (active ? `${run.progress}%` : "—")}</span>
          </MetaTile>
          <MetaTile label={hasBytes ? t("detailTransferBytes") : `${t("detailSucceeded")} / ${t("detailFailed")}`}>
            {hasBytes ? (
              <span className="tabular-nums">
                {run.bytes_total > 0
                  ? `${formatBytesString(run.bytes_processed)} / ${formatBytesString(run.bytes_total)}`
                  : formatBytesString(run.bytes_processed)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">{run.success_count}</span>
                <span className="text-muted-foreground/60">/</span>
                <span className={run.failure_count > 0 ? "text-destructive" : "text-muted-foreground"}>
                  {run.failure_count}
                </span>
              </span>
            )}
          </MetaTile>
          <MetaTile label={t("detailStartedAt")}>
            <span className="tabular-nums">{formatTimestamp(run.started_at)}</span>
          </MetaTile>
          <MetaTile label={t("detailFinishedAt")}>
            <span className="tabular-nums">{formatTimestamp(run.finished_at)}</span>
          </MetaTile>
          {run.stage ? (
            <MetaTile label={t("detailStage")}>
              <span className="font-mono text-[11px]">{run.stage}</span>
            </MetaTile>
          ) : run.attempt > 1 ? (
            <MetaTile label={t("detailAttempt")}>{t("attemptValue", { count: run.attempt })}</MetaTile>
          ) : (
            <MetaTile label={t("detailProgress")}>
              <span className="tabular-nums">{run.progress}%</span>
            </MetaTile>
          )}
        </div>

        {/* 结构化主机/文件执行结果 */}
        <ExecutionResult raw={run.result_json} />

        {/* 竖向执行事件时间轴 */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("timelineTitle")}
            </h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {events.length}
            </span>
          </div>

          {events.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
              {t("eventsEmpty")}
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/15 px-3.5 py-3">
              <ol className="relative ml-2 space-y-3 border-l border-border pl-4">
                {events.map((event) => {
                  const dotClass =
                    event.level === "error"
                      ? "bg-destructive ring-destructive/20"
                      : event.level === "warning"
                        ? "bg-amber-500 ring-amber-500/20"
                        : "bg-muted-foreground/50 ring-muted-foreground/15"
                  return (
                    <li key={event.id} className="relative text-xs">
                      <span
                        className={cn(
                          "absolute -left-[21px] top-1.5 size-2 rounded-full ring-4",
                          dotClass,
                        )}
                      />
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            event.level === "error"
                              ? "text-destructive"
                              : event.level === "warning"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                          )}
                        >
                          {t(`eventLevel${event.level.charAt(0).toUpperCase()}${event.level.slice(1)}`, {
                            defaultValue: event.level,
                          })}
                        </span>
                        <time className="text-[11px] tabular-nums text-muted-foreground">
                          {formatTimestamp(event.created_at)}
                        </time>
                      </div>
                      <p className="mt-0.5 break-words leading-5 text-foreground/90">{event.message}</p>
                      {event.data_json ? (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                            {t("eventDataToggle")}
                          </summary>
                          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background/80 p-2.5 font-mono text-[11px] leading-relaxed">
                            {formatPrettyJson(event.data_json)}
                          </pre>
                        </details>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
              {moreEvents ? (
                <div className="mt-3 flex justify-center border-t pt-2.5">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={loadingEvents} onClick={loadMore}>
                    {loadingEvents ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                    {t("loadMoreEvents")}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {/* 底部吸底操作栏 */}
      {hasFooterActions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2.5 sm:px-5">
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {run.attempt > 1 ? t("attemptValue", { count: run.attempt }) : formatTimestamp(run.created_at)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onDownloadArtifact ? (
              <Button variant="outline" size="sm" disabled={downloadingArtifact} onClick={onDownloadArtifact}>
                {downloadingArtifact ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                {t("downloadArtifact")}
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={Boolean(pendingAction)}
                onClick={() => onAction("cancel", run)}
              >
                {pendingAction === "cancel" ? <Loader2 className="size-3.5 animate-spin" /> : <CircleStop className="size-3.5" />}
                {t("cancelTask")}
              </Button>
            ) : null}
            {canRetry ? (
              <Button size="sm" disabled={Boolean(pendingAction)} onClick={() => onAction("retry", run)}>
                {pendingAction === "retry" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                {t("retryTask")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MetaTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/25 px-3 py-2">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xs font-medium text-foreground">{children}</div>
    </div>
  )
}

function formatPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
