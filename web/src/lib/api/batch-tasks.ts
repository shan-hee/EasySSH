import type {
  BatchTask,
  BatchTaskStatistics,
  CreateBatchTaskRequest,
  ListBatchTasksParams,
  ListBatchTasksResponse,
  UpdateBatchTaskRequest,
} from "@/lib/batch-task-types"

export type {
  BatchTask,
  BatchTaskStatistics,
  CreateBatchTaskRequest,
  ListBatchTasksParams,
  ListBatchTasksResponse,
  UpdateBatchTaskRequest,
} from "@/lib/batch-task-types"

export const batchTasksApi = {
  /**
   * 获取批量任务列表
   */
  async list(_params?: ListBatchTasksParams): Promise<ListBatchTasksResponse> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 创建批量任务
   */
  async create(_data: CreateBatchTaskRequest): Promise<BatchTask> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 获取批量任务详情
   */
  async getById(_id: string): Promise<BatchTask> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 更新批量任务
   */
  async update(
    _id: string,
    _data: UpdateBatchTaskRequest
  ): Promise<BatchTask> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 删除批量任务
   */
  async delete(_id: string): Promise<{ message: string }> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 获取批量任务统计信息
   */
  async getStatistics(): Promise<BatchTaskStatistics> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  /**
   * 启动批量任务
   */
  async start(_id: string): Promise<{ message: string }> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
}
