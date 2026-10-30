import { apiFetch } from "@/lib/api-client"
import type {
  CreateServerRequest,
  Server,
  ServerGroup,
  ServerListParams,
  ServerListResponse,
  ServerStatisticsResponse,
  UpdateServerRequest,
} from "@/lib/server-types"

export type {
  AuthMethod,
  CreateServerRequest,
  Server,
  ServerGroup,
  ServerListParams,
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
  async list(params?: ServerListParams): Promise<ServerListResponse> {
    const queryParams = new URLSearchParams()
    if (params?.page) queryParams.set("page", params.page.toString())
    if (params?.limit) queryParams.set("limit", params.limit.toString())
    if (params?.groupId) queryParams.set("group_id", params.groupId)
    if (params?.search) queryParams.set("q", params.search)
    if (params?.tag) queryParams.set("tag", params.tag)

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

/** 服务器分组：分组以 ID 关联，名称在实例内唯一。 */
export const serverGroupsApi = {
  /** 分组数量有限，按每页上限读取全部。 */
  async list(): Promise<ServerGroup[]> {
    const groups: ServerGroup[] = []
    for (let page = 1; ; page++) {
      const result = await apiFetch<{ items: ServerGroup[]; total: number }>(`/server-groups?page=${page}&limit=100`)
      groups.push(...result.items)
      if (result.items.length === 0 || groups.length >= result.total) return groups
    }
  },

  create(name: string): Promise<ServerGroup> {
    return apiFetch<ServerGroup>("/server-groups", { method: "POST", body: { name } })
  },
}
