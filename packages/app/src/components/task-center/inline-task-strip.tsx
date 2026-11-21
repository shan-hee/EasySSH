import { AlertTriangle, CheckCircle2, CircleStop, ExternalLink, Loader2, X, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { isTerminalTaskStatus, type TrackedInlineTask } from "@/hooks/use-inline-task-tracker"

export interface InlineTaskStripProps {
  tasks: TrackedInlineTask[]
  onCancel?: (id: string) => void
  onDismiss: (id: string) => void
  onOpenTask: (id: string) => void
  className?: string
}

export function InlineTaskStrip({
  tasks,
  onCancel,
  onDismiss,
  onOpenTask,
  className,
}: InlineTaskStripProps) {
  const { t } = useTranslation("taskCenter")
  if (tasks.length === 0) return null

  return (
    <div
      className={cn("shrink-0 divide-y border-b bg-muted/35 text-xs", className)}
      role="status"
      aria-live="polite"
    >
      {tasks.map((task) => {
        const terminal = isTerminalTaskStatus(task.status)
        const isActive = !terminal
        const canCancel = Boolean(onCancel && task.cancelable && (task.status === "queued" || task.status === "running") && !task.canceling)
        return (
          <div key={task.id} className="flex items-center gap-2.5 px-3 py-1.5">
            <TaskStatusIcon status={task.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-foreground">{task.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {inlineStatusText(task, t)}
                </span>
              </div>
              {isActive && (
                <div className="mt-1 flex items-center gap-2">
                  <Progress value={task.progress} className="h-1 flex-1" />
                  <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                    {task.progress}%
                  </span>
                </div>
              )}
              {terminal && task.errorMessage && (
                <p className="mt-0.5 truncate text-[11px] text-destructive" title={task.errorMessage}>
                  {task.errorMessage}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
                  onClick={() => onCancel?.(task.id)}
                >
                  <CircleStop className="mr-1 size-3" />
                  {t("cancelTask")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => onOpenTask(task.id)}
              >
                <ExternalLink className="mr-1 size-3" />
                {t("openInTaskCenter", { defaultValue: "任务中心" })}
              </Button>
              {terminal && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  aria-label={t("dismissInlineTask", { defaultValue: "关闭" })}
                  onClick={() => onDismiss(task.id)}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TaskStatusIcon({ status }: { status: TrackedInlineTask["status"] }) {
  if (status === "succeeded") {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
  }
  if (status === "failed" || status === "timeout") {
    return <XCircle className="size-3.5 shrink-0 text-destructive" />
  }
  if (status === "partial_success" || status === "unknown" || status === "canceled") {
    return <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
  }
  return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
}

function inlineStatusText(task: TrackedInlineTask, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (task.status) {
    case "queued":
      return t("statusQueued")
    case "running":
      return t("statusRunning")
    case "canceling":
      return t("statusCanceling")
    case "succeeded":
      return t("statusSucceeded")
    case "partial_success":
      return t("statusPartial")
    case "canceled":
      return t("statusCanceled")
    case "timeout":
      return t("statusTimeout")
    case "unknown":
      return t("statusUnknown")
    default:
      return t("statusFailed")
  }
}
