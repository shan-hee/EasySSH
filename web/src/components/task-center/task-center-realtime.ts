import type { TaskEvent, TaskRun, TaskRunListResponse, TaskRunStatus, TaskRunSummary } from "./task-center-contracts"

export interface TaskRealtimePatch {
  taskId: string
  status?: TaskRunStatus
  progress?: number
  stage?: string
  updatedAt: string
}

export function taskRealtimePatchFromEvent(event: { data: Record<string, unknown>; created_at: string }): TaskRealtimePatch | null {
  const taskId = typeof event.data.task_id === "string" ? event.data.task_id : null
  if (!taskId) return null
  return {
    taskId,
    status: typeof event.data.status === "string" ? event.data.status as TaskRunStatus : undefined,
    progress: typeof event.data.progress === "number" ? event.data.progress : undefined,
    stage: typeof event.data.stage === "string" ? event.data.stage : undefined,
    updatedAt: event.created_at,
  }
}

function patchRun<TRun extends TaskRun | TaskRunSummary>(run: TRun, patch: TaskRealtimePatch): TRun {
  return {
    ...run,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
    updated_at: patch.updatedAt,
  } as TRun
}

export function patchTaskRunList(current: TaskRunListResponse, patch: TaskRealtimePatch) {
  const runIndex = current.runs.findIndex((run) => run.id === patch.taskId)
  if (runIndex < 0) return { data: current, found: false, statusChanged: false }
  const currentRun = current.runs[runIndex]
  const runs = [...current.runs]
  runs[runIndex] = patchRun(currentRun, patch)
  return {
    data: { ...current, runs },
    found: true,
    statusChanged: Boolean(patch.status && patch.status !== currentRun.status),
  }
}

export function patchTaskRunDetail(
  current: { run: TaskRun; events: TaskEvent[] },
  patch: TaskRealtimePatch,
) {
  if (current.run.id !== patch.taskId) return current
  return { ...current, run: patchRun(current.run, patch) }
}
