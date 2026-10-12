import type { TaskCenterApi, TaskRunListParams } from "@/components/task-center/task-center-contracts"

export type {
  TaskCenterApi,
  TaskCleanupResult,
  TaskEvent,
  TaskRun,
  TaskRunListParams,
  TaskRunListResponse,
  TaskRunStatus,
  TaskStatistics,
} from "@/components/task-center/task-center-contracts"

export const taskCenterApi: TaskCenterApi = {
  list(_params: TaskRunListParams = {}) { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
  statistics() { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
  cleanup(_retentionDays: number) { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
  get(_id: string) { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
  cancel(_id: string) { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
  retry(_id: string) { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
}
