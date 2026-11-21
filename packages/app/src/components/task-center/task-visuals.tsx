import type { TFunction } from "i18next"
import {
  ArrowLeftRight,
  Clock3,
  Container,
  Cpu,
  Download,
  FileCode2,
  FolderCog,
  Layers,
  Loader2,
  Settings2,
  Terminal,
  Trash2,
  Upload,
  User,
} from "lucide-react"
import type { TaskRun, TaskRunStatus } from "@/components/task-center/task-center-contracts"
import { formatInTimezone } from "@/utils/datetime"
import { cn } from "@/lib/utils"

export const ACTIVE_STATUSES: TaskRunStatus[] = ["queued", "running", "canceling"]
export const ATTENTION_STATUSES: TaskRunStatus[] = ["failed", "partial_success", "timeout", "unknown"]
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const statusLabelKeys: Record<TaskRunStatus, string> = {
  queued: "statusQueued",
  running: "statusRunning",
  succeeded: "statusSucceeded",
  failed: "statusFailed",
  partial_success: "statusPartial",
  canceling: "statusCanceling",
  canceled: "statusCanceled",
  timeout: "statusTimeout",
  unknown: "statusUnknown",
}

export function isTaskActive(status: TaskRunStatus): boolean {
  return status === "queued" || status === "running" || status === "canceling"
}

export function isTaskAttention(status: TaskRunStatus): boolean {
  return status === "failed" || status === "partial_success" || status === "timeout" || status === "unknown"
}

export function triggerTypeLabel(type: TaskRun["trigger_type"], t: TFunction): string {
  return t(({
    manual: "triggerManual",
    scheduled: "triggerScheduled",
    system: "triggerSystem",
    api: "triggerApi",
  } as const)[type])
}

export function formatTaskResourcePreview(run: Pick<TaskRun, "resource" | "server_name">, t: TFunction): string {
  const resource = run.resource?.trim()
  if (!resource) return run.server_name || "—"
  const parts = resource.split(",").map((item) => item.trim()).filter(Boolean)
  if (parts.length > 0 && parts.every((part) => UUID_PATTERN.test(part))) {
    if (parts.length === 1 && run.server_name) return run.server_name
    return t("targetServersCount", { count: parts.length })
  }
  if (run.server_name && !resource.includes(run.server_name)) {
    return `${run.server_name} · ${resource}`
  }
  return resource
}

export function formatTaskDate(value: string | undefined, locale: "zh-CN" | "en-US", timezone: string): string {
  if (!value) return "—"
  return formatInTimezone(
    value,
    { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" },
    locale,
    timezone,
  )
}

export function formatTaskShortTime(value: string | undefined, locale: "zh-CN" | "en-US", timezone: string): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return formatInTimezone(
    value,
    sameDay
      ? { year: undefined, month: undefined, day: undefined, hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { year: undefined, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: undefined },
    locale,
    timezone,
  )
}

export function formatRunDuration(startedAt?: string, finishedAt?: string): string {
  if (!startedAt || !finishedAt) return ""
  const start = new Date(startedAt).getTime()
  const end = new Date(finishedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return ""
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

export function TaskTypeAvatar({
  taskType,
  active = false,
  size = "md",
}: {
  taskType: string
  active?: boolean
  size?: "sm" | "md" | "lg"
}) {
  const { icon: Icon, tone } = resolveTaskTypeVisual(taskType)
  const boxClass = size === "lg" ? "size-10 rounded-xl" : size === "sm" ? "size-7 rounded-md" : "size-8 rounded-lg"
  const iconClass = size === "lg" ? "size-5" : size === "sm" ? "size-3.5" : "size-4"

  return (
    <div className={cn("relative flex shrink-0 items-center justify-center", boxClass, tone)}>
      <Icon className={iconClass} />
      {active ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-sky-500 ring-2 ring-card" />
        </span>
      ) : null}
    </div>
  )
}

function resolveTaskTypeVisual(taskType: string) {
  switch (taskType) {
    case "command":
    case "command_execute":
      return { icon: Terminal, tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" }
    case "script":
      return { icon: FileCode2, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" }
    case "sftp_upload":
      return { icon: Upload, tone: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" }
    case "sftp_download":
      return { icon: Download, tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400" }
    case "sftp_transfer":
      return { icon: ArrowLeftRight, tone: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" }
    case "sftp_recursive_delete":
    case "sftp_delete_file":
    case "sftp_batch_delete":
      return { icon: Trash2, tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400" }
    case "sftp_mkdir":
    case "sftp_rename":
    case "sftp_chmod":
    case "sftp_write":
      return { icon: FolderCog, tone: "bg-slate-500/10 text-slate-600 dark:text-slate-400" }
    default:
      if (taskType.startsWith("docker_")) {
        return { icon: Container, tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400" }
      }
      return { icon: Layers, tone: "bg-muted text-muted-foreground" }
  }
}

export function TaskStatusPill({
  status,
  t,
  compact = false,
}: {
  status: TaskRunStatus
  t: TFunction
  compact?: boolean
}) {
  const styles: Record<TaskRunStatus, { pill: string; dot: string; spin?: boolean }> = {
    queued: {
      pill: "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300",
      dot: "bg-slate-500",
    },
    running: {
      pill: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
      dot: "bg-sky-500",
      spin: true,
    },
    canceling: {
      pill: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      dot: "bg-amber-500",
      spin: true,
    },
    succeeded: {
      pill: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      dot: "bg-emerald-500",
    },
    failed: {
      pill: "border-destructive/25 bg-destructive/10 text-destructive",
      dot: "bg-destructive",
    },
    timeout: {
      pill: "border-destructive/25 bg-destructive/10 text-destructive",
      dot: "bg-destructive",
    },
    partial_success: {
      pill: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      dot: "bg-amber-500",
    },
    unknown: {
      pill: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      dot: "bg-amber-500",
    },
    canceled: {
      pill: "border-border bg-muted/70 text-muted-foreground",
      dot: "bg-muted-foreground/70",
    },
  }
  const style = styles[status]

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        compact ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        style.pill,
      )}
    >
      {style.spin ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <span className={cn("size-1.5 rounded-full", style.dot)} />
      )}
      <span>{t(statusLabelKeys[status])}</span>
    </span>
  )
}

export function TaskTriggerChip({
  trigger,
  t,
  subtleManual = false,
}: {
  trigger: TaskRun["trigger_type"]
  t: TFunction
  subtleManual?: boolean
}) {
  if (subtleManual && trigger === "manual") return null
  const config: Record<TaskRun["trigger_type"], { icon: typeof User; className: string }> = {
    manual: { icon: User, className: "bg-muted/70 text-muted-foreground" },
    scheduled: { icon: Clock3, className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
    api: { icon: Cpu, className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
    system: { icon: Settings2, className: "bg-muted/70 text-muted-foreground" },
  }
  const { icon: Icon, className } = config[trigger]
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", className)}>
      <Icon className="size-2.5" />
      <span>{triggerTypeLabel(trigger, t)}</span>
    </span>
  )
}
