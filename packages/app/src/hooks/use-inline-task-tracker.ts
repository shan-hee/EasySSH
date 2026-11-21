import { useCallback, useEffect, useRef, useState } from "react"
import type {
  SubscribeRealtimeEvents,
  TaskCenterApi,
  TaskRun,
  TaskRunStatus,
} from "@/components/task-center/task-center-contracts"
import { taskRealtimePatchFromEvent } from "@/components/task-center/task-center-realtime"
import { openWorkspaceTask } from "@/lib/workspace-task-navigation"

export type InlineTaskApi = Pick<TaskCenterApi, "get" | "cancel">

export interface TrackedInlineTask {
  id: string
  title: string
  taskType?: string
  status: TaskRunStatus
  progress: number
  stage?: string
  cancelable: boolean
  canceling?: boolean
  successCount?: number
  failureCount?: number
  errorMessage?: string
}

export interface TrackInlineTaskOptions {
  title: string
  taskType?: string
  cancelable?: boolean
  onSettled?: (run: TaskRun | null, finalStatus: TaskRunStatus) => void
}

const TERMINAL_STATUSES = new Set<TaskRunStatus>([
  "succeeded",
  "failed",
  "partial_success",
  "canceled",
  "timeout",
  "unknown",
])

export function isTerminalTaskStatus(status: TaskRunStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

interface TrackerInternalEntry {
  onSettled?: (run: TaskRun | null, finalStatus: TaskRunStatus) => void
  settled: boolean
  autoDismissTimer?: number
}

export function useInlineTaskTracker({
  api,
  subscribeEvents,
}: {
  api?: InlineTaskApi | null
  subscribeEvents?: SubscribeRealtimeEvents | null
}) {
  const [tasks, setTasks] = useState<TrackedInlineTask[]>([])
  const entriesRef = useRef<Map<string, TrackerInternalEntry>>(new Map())
  const apiRef = useRef(api)
  apiRef.current = api

  const clearEntryTimer = useCallback((id: string) => {
    const entry = entriesRef.current.get(id)
    if (entry?.autoDismissTimer !== undefined) {
      window.clearTimeout(entry.autoDismissTimer)
      entry.autoDismissTimer = undefined
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    clearEntryTimer(id)
    entriesRef.current.delete(id)
    setTasks((prev) => prev.filter((item) => item.id !== id))
  }, [clearEntryTimer])

  const settle = useCallback((id: string, status: TaskRunStatus, run: TaskRun | null) => {
    const entry = entriesRef.current.get(id)
    if (!entry || entry.settled) return
    entry.settled = true
    try {
      entry.onSettled?.(run, status)
    } catch (error) {
      console.error("[useInlineTaskTracker] onSettled callback failed:", error)
    }
    if (status === "succeeded") {
      clearEntryTimer(id)
      entry.autoDismissTimer = window.setTimeout(() => {
        dismiss(id)
      }, 4500)
    }
  }, [clearEntryTimer, dismiss])

  const refreshTask = useCallback(async (id: string) => {
    const currentApi = apiRef.current
    if (!currentApi || !entriesRef.current.has(id)) return
    try {
      const detail = await currentApi.get(id)
      const run = detail.run
      setTasks((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                title: run.title || item.title,
                taskType: run.task_type || item.taskType,
                status: run.status,
                progress: run.progress,
                stage: run.stage,
                cancelable: run.cancelable,
                canceling: run.status === "canceling",
                successCount: run.success_count,
                failureCount: run.failure_count,
                errorMessage: run.error_message,
              }
            : item,
        ),
      )
      if (isTerminalTaskStatus(run.status)) {
        settle(id, run.status, run)
      }
    } catch {
      // Transient fetch failures will retry on next poll or event.
    }
  }, [settle])

  const track = useCallback((id: string, options: TrackInlineTaskOptions) => {
    if (!id) return
    const existing = entriesRef.current.get(id)
    if (existing) {
      clearEntryTimer(id)
    }
    entriesRef.current.set(id, {
      onSettled: options.onSettled,
      settled: false,
    })
    setTasks((prev) => {
      const nextItem: TrackedInlineTask = {
        id,
        title: options.title,
        taskType: options.taskType,
        status: "queued",
        progress: 0,
        cancelable: options.cancelable ?? true,
      }
      const exists = prev.some((item) => item.id === id)
      return exists ? prev.map((item) => (item.id === id ? nextItem : item)) : [nextItem, ...prev]
    })
    void refreshTask(id)
  }, [clearEntryTimer, refreshTask])

  const cancel = useCallback(async (id: string) => {
    const currentApi = apiRef.current
    if (!currentApi) return
    setTasks((prev) => prev.map((item) => (item.id === id ? { ...item, canceling: true } : item)))
    try {
      const result = await currentApi.cancel(id)
      setTasks((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: result.status,
                canceling: result.status === "canceling",
              }
            : item,
        ),
      )
      if (isTerminalTaskStatus(result.status)) {
        void refreshTask(id)
      }
    } catch {
      setTasks((prev) => prev.map((item) => (item.id === id ? { ...item, canceling: false } : item)))
    }
  }, [refreshTask])

  const hasActiveTasks = tasks.some((item) => !isTerminalTaskStatus(item.status))

  // Subscribe to realtime events for tracked tasks.
  useEffect(() => {
    if (!subscribeEvents) return
    return subscribeEvents((event) => {
      if (!event.type.startsWith("task.")) return
      const patch = taskRealtimePatchFromEvent(event)
      if (!patch || !entriesRef.current.has(patch.taskId)) return
      if (patch.status !== undefined || patch.progress !== undefined || patch.stage !== undefined) {
        setTasks((prev) =>
          prev.map((item) =>
            item.id === patch.taskId
              ? {
                  ...item,
                  ...(patch.status ? { status: patch.status, canceling: patch.status === "canceling" } : {}),
                  ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
                  ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
                }
              : item,
          ),
        )
      }
      if (!patch.status || isTerminalTaskStatus(patch.status) || event.type === "task.completed") {
        void refreshTask(patch.taskId)
      }
    })
  }, [refreshTask, subscribeEvents])

  // Lightweight polling fallback while any tracked task is still active.
  useEffect(() => {
    if (!hasActiveTasks || !api) return
    const timer = window.setInterval(() => {
      for (const [id, entry] of entriesRef.current.entries()) {
        if (!entry.settled) {
          void refreshTask(id)
        }
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [api, hasActiveTasks, refreshTask])

  // Cleanup timers on unmount.
  useEffect(() => {
    const entries = entriesRef.current
    return () => {
      for (const entry of entries.values()) {
        if (entry.autoDismissTimer !== undefined) {
          window.clearTimeout(entry.autoDismissTimer)
        }
      }
      entries.clear()
    }
  }, [])

  return {
    tasks,
    track,
    cancel,
    dismiss,
    openInTaskCenter: openWorkspaceTask,
  }
}
