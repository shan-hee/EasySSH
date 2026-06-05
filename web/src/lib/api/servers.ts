import { apiFetch } from "@/lib/api-client"
import type {
  CreateServerRequest,
  Server,
  ServerListResponse,
  ServerStatisticsResponse,
  UpdateServerRequest,
} from "@/lib/server-types"

export type {
  AuthMethod,
  CreateServerRequest,
  Server,
  ServerListResponse,
  ServerStatisticsResponse,
  ServerStatus,
  UpdateServerRequest,
} from "@/lib/server-types"

/**
 * 服务器 API 服务
 */
export const serversApi = {
  /**
   * 获取服务器列表
   */
  async list(params?: {
    page?: number
    limit?: number
    group?: string
    search?: string
  }): Promise<ServerListResponse> {
    const queryParams = new URLSearchParams()
    if (params?.page) queryParams.set("page", params.page.toString())
    if (params?.limit) queryParams.set("limit", params.limit.toString())
    if (params?.group) queryParams.set("group", params.group)
    if (params?.search) queryParams.set("search", params.search)

    const url = `/servers${queryParams.toString() ? `?${queryParams}` : ""}`
    return apiFetch<ServerListResponse>(url)
  },

  /**
   * 获取服务器详情
   */
  async getById(id: string): Promise<Server> {
    return apiFetch<Server>(`/servers/${id}`)
  },

  /**
   * 创建服务器
   */
  async create(data: CreateServerRequest): Promise<Server> {
    return apiFetch<Server>("/servers", {
      method: "POST",
      body: data,
    })
  },

  /**
   * 更新服务器
   */
  async update(id: string, data: UpdateServerRequest): Promise<Server> {
    return apiFetch<Server>(`/servers/${id}`, {
      method: "PUT",
      body: data,
    })
  },

  /**
   * 删除服务器
   */
  async delete(id: string): Promise<void> {
    return apiFetch<void>(`/servers/${id}`, {
      method: "DELETE",
    })
  },

  /**
   * 获取服务器统计信息
   */
  async getStatistics(): Promise<ServerStatisticsResponse> {
    return apiFetch<ServerStatisticsResponse>("/servers/statistics")
  },

  /**
   * 批量更新服务器排序顺序
   */
  async reorder(serverIds: string[]): Promise<void> {
    return apiFetch<void>("/servers/reorder", {
      method: "PATCH",
      body: { server_ids: serverIds },
    })
  },
}
