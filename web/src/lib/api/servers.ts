import type { CreateServerRequest, Server, ServerListResponse, ServerStatisticsResponse, UpdateServerRequest } from "@/lib/server-types"
import { configSnapshot, configuration, credentialsResource, orderedIDs, orderKey, saveServer, scheduleSync, serverFromRecord } from "@/lib/secure-runtime/records"
import { currentWorkspace } from "@/lib/secure-runtime/session"
export type { AuthMethod, CreateServerRequest, Server, ServerListResponse, ServerStatisticsResponse, ServerStatus, UpdateServerRequest } from "@/lib/server-types"

export const serversApi = {
  async list(params?: { page?: number; limit?: number; group?: string; search?: string }): Promise<ServerListResponse> {
    const snapshot = await configSnapshot()
    const search = params?.search?.toLocaleLowerCase()
    const rows = orderedIDs(snapshot).map((id) => serverFromRecord(id, snapshot['server/' + id])).filter((s) =>
      (!params?.group || s.group === params.group) && (!search || [s.name, s.host, s.username].join(' ').toLocaleLowerCase().includes(search)))
    const page = Math.max(1, params?.page || 1), limit = Math.max(1, params?.limit || 100)
    return { data: await withCredentialFlags(rows.slice((page - 1) * limit, page * limit), snapshot), total: rows.length, page, limit }
  },
  async getById(id: string): Promise<Server> {
    if ((await currentWorkspace().conflicts("config", configuration)).some((c) => c.key === "server/" + id && c.field === "connection")) throw new Error("服务器连接配置存在冲突，请先在加密工作区选择版本")
    const record = (await configSnapshot())['server/' + id]
    if (!record) throw new Error("服务器不存在")
    return (await withCredentialFlags([serverFromRecord(id, record)], { ["server/" + id]: record }))[0]
  },
  create(data: CreateServerRequest) { return saveServer(crypto.randomUUID(), data, true) },
  update(id: string, data: UpdateServerRequest) { return saveServer(id, data, false) },
  async delete(id: string): Promise<void> {
    const workspace = currentWorkspace()
    await workspace.editMany([
      { scope: "config", resource: configuration, edit(snapshot) { delete snapshot['server/' + id]; return snapshot } },
      ...(workspace.view?.scopes.includes("credentials") ? [{ scope: "credentials" as const, resource: credentialsResource,
        edit(snapshot: Record<string, Record<string, string>>) { delete snapshot['value/' + id]; return snapshot } }] : []),
    ])
    scheduleSync()
  },
  async getStatistics(): Promise<ServerStatisticsResponse> {
    const rows = (await this.list({ limit: 10000 })).data
    const by_group: Record<string, number> = {}, by_tag: Record<string, number> = {}
    for (const row of rows) { by_group[row.group || ""] = (by_group[row.group || ""] || 0) + 1; for (const tag of row.tags || []) by_tag[tag] = (by_tag[tag] || 0) + 1 }
    return { total: rows.length, online: rows.filter((s) => s.status === "online").length, offline: rows.filter((s) => s.status !== "online").length, by_group, by_tag }
  },
  async reorder(serverIds: string[]): Promise<void> {
    await currentWorkspace().edit("config", configuration, (snapshot) => {
      if (new Set(serverIds).size !== serverIds.length || serverIds.some((id) => !snapshot['server/' + id])) throw new Error("服务器排序包含重复或未知服务器")
      return { ...snapshot, [orderKey]: { ids: JSON.stringify(serverIds) } }
    })
    scheduleSync()
  },
}

async function withCredentialFlags(servers: Server[], config: Record<string, Record<string, string>>): Promise<Server[]> {
 const workspace = currentWorkspace()
 if (!workspace.view?.scopes.includes("credentials")) return servers
 const snapshot = await workspace.snapshot("credentials", credentialsResource)
 return servers.map((server) => {
  const value = JSON.parse(snapshot['value/' + server.id]?.content || "{}")
  const current = config['server/' + server.id]?.connection
  return { ...server, has_password: value.connection === current && !!value.password, has_private_key: value.connection === current && !!value.private_key }
 })
}
