
export type ScheduledTaskType = "command" | "script" | "sftp_upload" | "sftp_download"

// 定时任务类型定义
export interface ScheduledTask {
  id: string
  user_id: string
  task_name: string
  task_type: ScheduledTaskType
  script_id?: string
  command?: string
  payload_json?: string
  server_ids?: string[]
  cron_expression: string
  timezone: string
  enabled: boolean
  last_run_at?: string
  next_run_at?: string
  run_count: number
  failure_count: number
  last_status?: "success" | "failed" | "canceled"
  description: string
  created_at: string
  updated_at: string
}

export interface CreateScheduledTaskRequest {
  task_name: string
  task_type: ScheduledTaskType
  script_id?: string
  command?: string
  payload_json?: string
  server_ids?: string[]
  cron_expression: string
  timezone?: string
  enabled?: boolean
  description?: string
}

export interface UpdateScheduledTaskRequest {
  task_name?: string
  task_type?: ScheduledTaskType
  command?: string
  payload_json?: string
  server_ids?: string[]
  cron_expression?: string
  timezone?: string
  enabled?: boolean
  description?: string
}

export interface ListScheduledTasksParams {
  page?: number
  limit?: number
  enabled?: boolean
  task_type?: ScheduledTaskType
}

export interface ListScheduledTasksResponse {
  data: ScheduledTask[]
  total: number
  page: number
  limit: number
  total_pages: number
}

export interface ScheduledTaskStatistics {
  total_tasks: number
  enabled_tasks: number
  disabled_tasks: number
  total_runs: number
  by_type: {
    [key: string]: number
  }
}

export const scheduledTasksApi = {
  /**
   * 获取定时任务列表
   */
  async list(
    _params?: ListScheduledTasksParams
  ): Promise<ListScheduledTasksResponse> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 创建定时任务
   */
  async create(
    _data: CreateScheduledTaskRequest
  ): Promise<ScheduledTask> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 获取定时任务详情
   */
  async getById(_id: string): Promise<ScheduledTask> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 更新定时任务
   */
  async update(
    _id: string,
    _data: UpdateScheduledTaskRequest
  ): Promise<ScheduledTask> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 删除定时任务
   */
  async delete(_id: string): Promise<{ message: string }> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 获取定时任务统计信息
   */
  async getStatistics(): Promise<ScheduledTaskStatistics> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 启用/禁用定时任务
   */
  async toggle(_id: string, _enabled: boolean): Promise<{ message: string }> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 手动触发定时任务
   */
  async trigger(_id: string): Promise<{ message: string; task_run_id: string }> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
}
