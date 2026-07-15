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

export interface TaskCleanupResult {
  deleted_count: number
  deleted_events: number
  deleted_notifications: number
  retention_days: number
}

export interface TaskRunListParams {
  status?: TaskRunStatus[]
  task_type?: string[]
  trigger_type?: TaskRun["trigger_type"][]
  keyword?: string
  page?: number
  page_size?: number
}

export interface TaskCenterApi {
  list(params?: TaskRunListParams): Promise<TaskRunListResponse>
  statistics(): Promise<TaskStatistics>
  cleanup(retentionDays: number): Promise<TaskCleanupResult>
  get(id: string): Promise<{ run: TaskRun; events: TaskEvent[] }>
  cancel(id: string): Promise<{ id: string; status: TaskRunStatus }>
  retry(id: string): Promise<{ definition_id?: string; id?: string; retry_of_id: string }>
}

export interface RealtimeEvent<TData = Record<string, unknown>> {
  id: string
  type: string
  data: TData
  created_at: string
}

export type RealtimeEventListener = (event: RealtimeEvent) => void
export type SubscribeRealtimeEvents = (listener: RealtimeEventListener) => () => void
