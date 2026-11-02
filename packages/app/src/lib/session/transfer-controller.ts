import type { WorkspaceTransferStatus } from "./workspace"
import {
  mergeTransferTaskUpdate,
  type TransferTask,
  type TransferTaskUpdate,
} from "./transfer-tasks"

export const TRANSFER_ACTIVE_STATUSES: readonly WorkspaceTransferStatus[] = [
  "pending",
  "uploading",
  "downloading",
  "transferring",
]

export const TRANSFER_SETTLED_STATUSES: readonly WorkspaceTransferStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "unknown",
]

export interface ApplyTransferTaskUpdateOptions {
  mergeProgress?: boolean
}

export function isTransferTaskActiveStatus(status: WorkspaceTransferStatus | undefined): boolean {
  return status === undefined || TRANSFER_ACTIVE_STATUSES.includes(status)
}

export function isTransferTaskSettledStatus(status: WorkspaceTransferStatus | undefined): boolean {
  return status !== undefined && TRANSFER_SETTLED_STATUSES.includes(status)
}

export function findTransferTask(
  tasks: readonly TransferTask[],
  taskId: string,
): TransferTask | undefined {
  return tasks.find((task) => task.id === taskId)
}

export function getActiveTransferTasks(tasks: readonly TransferTask[]): TransferTask[] {
  return tasks.filter((task) => isTransferTaskActiveStatus(task.status))
}

export function getSettledTransferTaskIds(tasks: readonly TransferTask[]): string[] {
  return tasks
    .filter((task) => isTransferTaskSettledStatus(task.status))
    .map((task) => task.id)
}

export function getTransferTaskIds(tasks: readonly TransferTask[]): string[] {
  return tasks.map((task) => task.id)
}

export function appendTransferTask(
  tasks: readonly TransferTask[],
  task: TransferTask,
): TransferTask[] {
  return [...tasks, task]
}

export function mergeRestoredTransferTasks(
  tasks: readonly TransferTask[],
  restoredTasks: readonly TransferTask[],
): TransferTask[] {
  if (restoredTasks.length === 0) {
    return [...tasks]
  }

  const existingIds = new Set(tasks.map((task) => task.id))
  const merged = [...tasks]

  for (const task of restoredTasks) {
    if (!existingIds.has(task.id)) {
      merged.push(task)
      existingIds.add(task.id)
    }
  }

  return merged
}

export function applyTransferTaskUpdate(
  tasks: readonly TransferTask[],
  taskId: string,
  update: TransferTaskUpdate,
  { mergeProgress = false }: ApplyTransferTaskUpdateOptions = {},
): TransferTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) {
      return task
    }

    return mergeProgress
      ? mergeTransferTaskUpdate(task, update)
      : { ...task, ...update }
  })
}

export function markTransferTaskCancelled(
  tasks: readonly TransferTask[],
  taskId: string,
): TransferTask[] {
  return applyTransferTaskUpdate(tasks, taskId, { status: "cancelled", speed: undefined, timeRemaining: undefined })
}

export function removeTransferTaskById(
  tasks: readonly TransferTask[],
  taskId: string,
): TransferTask[] {
  return tasks.filter((task) => task.id !== taskId)
}

/** 传输面板可对一组任务执行的操作。 */
export interface TransferTaskActions {
  tasks: readonly TransferTask[]
  cancel: (taskId: string) => void
  remove: (taskId: string) => void
  /** 未提供时该来源的任务不可重试。 */
  retry?: (taskId: string) => Promise<void>
}

/** 合并多个来源的任务，操作按任务所属来源转发；没有来源时不显示传输面板。 */
export function mergeTransferTaskActions(
  candidates: readonly (TransferTaskActions | undefined)[],
): TransferTaskActions | undefined {
  const sources = candidates.filter((source): source is TransferTaskActions => !!source)
  if (sources.length <= 1) return sources[0]
  const owner = (taskId: string) => sources.find((source) => source.tasks.some((task) => task.id === taskId))
  return {
    tasks: sources.flatMap((source) => source.tasks),
    cancel: (taskId) => owner(taskId)?.cancel(taskId),
    remove: (taskId) => owner(taskId)?.remove(taskId),
    retry: (taskId) => owner(taskId)?.retry?.(taskId) ?? Promise.resolve(),
  }
}
