import { useEffect, useMemo, useState } from "react"
import { getToolName, isToolUIPart, type UIMessage } from "ai"
import { Check, ShieldAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { TaskView } from "@/lib/api/ai-agent"
import type { TimelineTranslate } from "@/lib/ai-agent/timeline-utils"
import { cn } from "@/lib/utils"

type ApprovalDecision = "confirm" | "reject"
type ApprovalQueueTask = Pick<
  TaskView,
  "arguments" | "dangerous" | "id" | "summary" | "tool_display_name" | "tool_name"
>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function getStreamingApprovalTasks(tasks: TaskView[], messages: UIMessage[]) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const pendingTasksById = new Map(
    tasks
      .filter((task) => task.status === "waiting_confirm")
      .map((task) => [task.id, task])
  )
  const result: ApprovalQueueTask[] = []
  const addedTaskIds = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || part.state !== "approval-requested" || !("approval" in part)) {
        continue
      }

      const approvalId = part.approval?.id
      if (!approvalId || addedTaskIds.has(approvalId)) {
        continue
      }

      const snapshotTask = tasksById.get(approvalId)
      if (snapshotTask && snapshotTask.status !== "waiting_confirm") {
        continue
      }

      if (snapshotTask) {
        result.push(snapshotTask)
      } else {
        const metadata = asRecord(part.toolMetadata)
        const displayName = metadata.displayName
        const summary = metadata.summary
        result.push({
          id: approvalId,
          tool_name: getToolName(part),
          tool_display_name: typeof displayName === "string" ? displayName : undefined,
          summary: typeof summary === "string" ? summary : undefined,
          dangerous: metadata.dangerous === true,
          arguments: "input" in part ? asRecord(part.input) : {},
        })
      }
      addedTaskIds.add(approvalId)
      pendingTasksById.delete(approvalId)
    }
  }

  result.push(...[...pendingTasksById.values()].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  ))
  return result
}

function getTaskDescription(task: ApprovalQueueTask) {
  const command = task.arguments?.command
  if (typeof command === "string" && command.trim()) {
    return `$ ${command}`
  }

  const path = task.arguments?.path
  if (typeof path === "string" && path.trim()) {
    return path
  }

  if (task.summary?.trim()) {
    return task.summary.trim()
  }

  return task.arguments && Object.keys(task.arguments).length > 0
    ? JSON.stringify(task.arguments)
    : ""
}

export function AgentApprovalQueue({
  tasks,
  messages,
  tText,
  onConfirmTask,
  compact = false,
  className,
}: {
  tasks: TaskView[]
  messages: UIMessage[]
  tText: TimelineTranslate
  onConfirmTask: (taskId: string, decision: ApprovalDecision) => boolean | Promise<boolean>
  compact?: boolean
  className?: string
}) {
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(() => new Set())
  const confirmationTasks = useMemo(
    () => getStreamingApprovalTasks(tasks, messages),
    [messages, tasks]
  )
  const visibleTasks = confirmationTasks.filter((item) => !hiddenTaskIds.has(item.id))
  const task = visibleTasks[0]

  useEffect(() => {
    const waitingTaskIds = new Set(confirmationTasks.map((item) => item.id))
    setHiddenTaskIds((current) => {
      if ([...current].every((taskId) => waitingTaskIds.has(taskId))) {
        return current
      }

      return new Set([...current].filter((taskId) => waitingTaskIds.has(taskId)))
    })

  }, [confirmationTasks])

  if (!task) {
    return null
  }

  const description = getTaskDescription(task)
  const submitDecision = async (decision: ApprovalDecision) => {
    const submittedTaskId = task.id
    setHiddenTaskIds((current) => new Set(current).add(submittedTaskId))
    let accepted = false
    try {
      accepted = await onConfirmTask(submittedTaskId, decision)
    } catch {
      accepted = false
    } finally {
      if (!accepted) {
        setHiddenTaskIds((current) => {
          const next = new Set(current)
          next.delete(submittedTaskId)
          return next
        })
      }
    }
  }

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={tText("pendingToolsHint", { count: visibleTasks.length })}
      className={cn(
        "overflow-hidden rounded-lg border border-amber-500/25 bg-popover/95 text-popover-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/90",
        compact && "rounded-md",
        className
      )}
    >
      <div className={cn(
        "flex items-start gap-3 p-3",
        compact && "gap-2.5 p-2.5",
        !compact && "max-sm:flex-wrap"
      )}>
        <div className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/[0.12] text-amber-600 dark:text-amber-400",
          compact && "size-7"
        )}>
          <ShieldAlert className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("font-medium text-sm", compact && "text-xs")}>
              {tText("confirmationRequested")}
            </span>
            {visibleTasks.length > 1 && (
              <span className="text-[11px] text-muted-foreground">
                1 / {visibleTasks.length}
              </span>
            )}
            {task.dangerous && (
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {tText("dangerousAction")}
              </span>
            )}
          </div>
          <div
            className={cn("mt-1 font-medium text-sm text-foreground/90", compact && "truncate text-xs")}
            title={task.tool_display_name || task.tool_name}
          >
            {task.tool_display_name || task.tool_name}
          </div>
          {description && (
            <div className={cn(
              "mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-4 text-muted-foreground",
              compact && "max-h-16 px-2 py-1.5"
            )}>
              {description}
            </div>
          )}
        </div>
        <div className={cn(
          "flex shrink-0 items-center gap-1.5 self-center",
          !compact && "max-sm:ml-11 max-sm:w-full max-sm:justify-end"
        )}>
          <Button
            type="button"
            size="sm"
            className={cn("h-8 gap-1.5 px-3", compact && "w-8 px-0")}
            onClick={() => void submitDecision("confirm")}
            aria-label={tText("confirmAction")}
            title={tText("confirmAction")}
          >
            <Check className="size-3.5" />
            <span className={cn(compact && "sr-only")}>{tText("confirmAction")}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              "h-8 gap-1.5 border-destructive/25 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive",
              compact && "w-8 px-0"
            )}
            onClick={() => void submitDecision("reject")}
            aria-label={tText("rejectAction")}
            title={tText("rejectAction")}
          >
            <X className="size-3.5" />
            <span className={cn(compact && "sr-only")}>{tText("rejectAction")}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
