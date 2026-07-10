import { apiFetch } from "@/lib/api-client"

export type TaskRunStatus = "queued" | "running" | "succeeded" | "failed" | "partial_success" | "canceling" | "canceled" | "timeout"

export interface TaskRun {
  id: string
  user_id: string
  definition_id?: string
  retry_of_id?: string
  source_type?: string
  source_id?: string
  task_type: string
  title: string
  description?: string
  trigger_type: "manual" | "scheduled" | "system" | "api"
  runner: string
  status: TaskRunStatus
  stage?: string
  server_id?: string
  server_name?: string
  resource?: string
  result_json?: string
  progress: number
  total_count: number
  success_count: number
  failure_count: number
  bytes_total: number
  bytes_processed: number
  progress_json?: string
  cancelable: boolean
  retryable: boolean
  attempt: number
  max_attempts: number
  error_code?: string
  error_message?: string
  started_at?: string
  finished_at?: string
  created_at: string
  updated_at: string
}

export interface TaskEvent {
  id: number
  task_run_id: string
  level: string
  message: string
  data_json?: string
  created_at: string
}

export interface TaskRunListResponse {
  runs: TaskRun[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface TaskStatistics {
  total: number
  queued: number
  running: number
  canceling: number
  succeeded: number
  failed: number
  partial_success: number
  canceled: number
  timeout: number
}

export interface TaskRunListParams {
  status?: TaskRunStatus[]
  task_type?: string[]
  trigger_type?: TaskRun["trigger_type"][]
  keyword?: string
  page?: number
  page_size?: number
}

export const taskCenterApi = {
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
