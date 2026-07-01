export interface BatchTask {
  id: string
  user_id: string
  task_name: string
  task_type: "command" | "script" | "file"
  content: string
  script_id?: string
  server_ids: string[]
  execution_mode: "parallel" | "sequential"
  status: "pending" | "running" | "completed" | "failed"
  success_count: number
  failed_count: number
  started_at?: string
  completed_at?: string
  duration?: number
  created_at: string
  updated_at: string
}

export interface CreateBatchTaskRequest {
  task_name: string
  task_type: "command" | "script" | "file"
  content?: string
  script_id?: string
  server_ids: string[]
  execution_mode?: "parallel" | "sequential"
}

export interface UpdateBatchTaskRequest {
  task_name?: string
  content?: string
  server_ids?: string[]
  execution_mode?: "parallel" | "sequential"
}

export interface ListBatchTasksParams {
  page?: number
  limit?: number
  status?: "pending" | "running" | "completed" | "failed"
  task_type?: "command" | "script" | "file"
}

export interface ListBatchTasksResponse {
  data: BatchTask[]
  total: number
  page: number
  limit: number
  total_pages: number
}

export interface BatchTaskStatistics {
  total_tasks: number
  pending_tasks: number
  running_tasks: number
  completed_tasks: number
  failed_tasks: number
  by_type: {
    [key: string]: number
  }
}
