import type { components } from "@/generated/openapi"
export type TaskRunStatus = components["schemas"]["TaskRunStatus"]

export interface TaskRun {
  id: string
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

export type TaskRunSummary = Omit<TaskRun, "description" | "result_json" | "progress_json">

export interface TaskRunListResponse {
  runs: TaskRunSummary[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export type TaskStatistics = components["schemas"]["TaskStatistics"]

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
  get(id: string): Promise<{ run: TaskRun; events: TaskEvent[]; eventPage?: components["schemas"]["TaskEventPage"] }>
  events?(id: string, after: number): Promise<components["schemas"]["TaskEventPage"]>
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
