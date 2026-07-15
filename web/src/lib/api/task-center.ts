import { apiFetch } from "@/lib/api-client"
import type {
  TaskCenterApi,
  TaskCleanupResult,
  TaskEvent,
  TaskRun,
  TaskRunListParams,
  TaskRunListResponse,
  TaskRunStatus,
  TaskStatistics,
} from "@/components/task-center/task-center-contracts"

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
  list(params: TaskRunListParams = {}) {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) query.set(key, value.join(","))
      else if (value !== undefined && value !== "") query.set(key, String(value))
    })
    return apiFetch<TaskRunListResponse>(`/tasks${query.size ? `?${query}` : ""}`)
  },
  statistics() {
    return apiFetch<TaskStatistics>("/tasks/statistics")
  },
  cleanup(retentionDays: number) {
    return apiFetch<TaskCleanupResult>(`/tasks/cleanup?retention_days=${retentionDays}`, { method: "DELETE" })
  },
  get(id: string) {
    return apiFetch<{ run: TaskRun; events: TaskEvent[] }>(`/tasks/${id}`)
  },
  cancel(id: string) {
    return apiFetch<{ id: string; status: TaskRunStatus }>(`/tasks/${id}/cancel`, { method: "POST" })
  },
  retry(id: string) {
    return apiFetch<{ definition_id: string; retry_of_id: string }>(`/tasks/${id}/retry`, { method: "POST" })
  },
}
