import type * as React from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { InlineStatusBadge, type DashboardTone } from "./log-dashboard-widgets"

export interface LogSortState {
  sort_by: string
  sort_order: "asc" | "desc"
}

export const defaultLogSort: LogSortState = {
  sort_by: "created_at",
  sort_order: "desc",
}

export function nextLogSort(current: LogSortState, field: string): LogSortState {
  return current.sort_by === field
    ? { sort_by: field, sort_order: current.sort_order === "asc" ? "desc" : "asc" }
    : { sort_by: field, sort_order: "desc" }
}

export function formatLogTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

export function formatLogDuration(milliseconds?: number) {
  if (!milliseconds) return "-"
  if (milliseconds < 1000) return `${milliseconds}ms`
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function formatLogBytes(bytes: number) {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function downloadLogsJson(rows: unknown[], filePrefix: string) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filePrefix}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** 日志表格的说明行：说明文字与最后更新时间，按内容自然换行。 */
export function LogTableSummary({ description, updatedAt }: { description: string; updatedAt: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <p className="min-w-0">{description}</p>
      <span className="shrink-0 tabular-nums">{updatedAt}</span>
    </div>
  )
}

export function LogSortHeader({
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
      className="h-7 max-w-full -translate-x-2 px-2 text-xs font-medium"
      onClick={() => onSort(field)}
    >
      <span className="truncate">{label}</span>
      <Icon className="ml-1.5 h-3.5 w-3.5" />
    </Button>
  )
}

export function LogDetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  )
}

/** 状态列：状态徽标，重试过的记录在右侧标出重试次数。 */
export function LogStatusCell({
  label,
  tone,
  retries = 0,
  retryLabel,
}: {
  label: string
  tone: DashboardTone
  retries?: number
  retryLabel?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <InlineStatusBadge label={label} tone={tone} />
      {retries > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums" title={retryLabel}>
          <RotateCw className="size-3" />
          {retries}
        </span>
      ) : null}
    </div>
  )
}

/** 进度列：上方为数据量（没有数据量时显示百分比），下方为细进度条，高度与状态徽标一致。 */
export function LogProgressCell({
  progress,
  bytesProcessed = 0,
  bytesTotal = 0,
  failed = false,
}: {
  progress: number
  bytesProcessed?: number
  bytesTotal?: number
  failed?: boolean
}) {
  const hasBytes = bytesTotal > 0 || bytesProcessed > 0
  if (!hasBytes && progress <= 0) return "-"
  const label = !hasBytes
    ? `${progress}%`
    : bytesTotal > 0
      ? `${formatLogBytes(bytesProcessed)} / ${formatLogBytes(bytesTotal)}`
      : formatLogBytes(bytesProcessed)

  return (
    <div className="flex h-5 w-full min-w-0 flex-col justify-center" title={`${progress}%`}>
      <span className="truncate text-xs leading-3.5 tabular-nums">{label}</span>
      <Progress
        value={progress}
        className="mt-0.5 h-1"
        indicatorClassName={failed ? "bg-rose-500" : undefined}
      />
    </div>
  )
}

/** 文件列：成功数 / 总数，有失败时以红色标出失败数。 */
export function LogFilesCell({
  total = 0,
  success = 0,
  failed = 0,
  failedLabel,
}: {
  total?: number
  success?: number
  failed?: number
  failedLabel?: string
}) {
  if (total <= 0 && success <= 0 && failed <= 0) return "-"
  return (
    <span className="whitespace-nowrap font-mono text-xs tabular-nums">
      {success}/{total}
      {failed > 0 ? (
        <span className="ml-1 text-rose-600 dark:text-rose-400" title={failedLabel}>✕{failed}</span>
      ) : null}
    </span>
  )
}
