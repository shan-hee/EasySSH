import type { components } from "@/generated/openapi"
import { resolveTaskDetails, resolveTaskEvents } from "@/components/task-center/task-content"
import { readInstanceContentChunk } from "@/lib/api/content"
import { apiFetch } from "@/lib/api-client"
import type {
  TaskCenterApi,
  TaskCleanupResult,
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
  async get(id: string) {
    const details = await apiFetch<components["schemas"]["TaskRunDetails"]>(`/tasks/${id}`)
    const run = await resolveTaskDetails(details, readInstanceContentChunk)
    const page = await taskCenterApi.events!(id, 0)
    return { run, events: page.events, eventPage: page }
  },
  async events(id, after) {
    const page = await apiFetch<components["schemas"]["TaskEventPage"]>(`/tasks/${id}/events?after_id=${after}&limit=50`)
    return resolveTaskEvents(page, readInstanceContentChunk)
  },
  cancel(id: string) {
    return apiFetch<{ id: string; status: TaskRunStatus }>(`/tasks/${id}/cancel`, { method: "POST" })
  },
  retry(id: string) {
    return apiFetch<{ id: string; definition_id: string; retry_of_id: string }>(`/tasks/${id}/retry`, { method: "POST" })
  },
}
