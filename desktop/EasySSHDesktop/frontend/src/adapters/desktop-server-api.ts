import type { Server, ServerConnectionConfigsApi } from "@easyssh/ssh-workspace/desktop"
import {
  DesktopServerAuthMethod,
  DesktopServerService,
  type DesktopServer,
  type DesktopServerInput,
} from "../../bindings/github.com/easyssh/easyssh-desktop"

export function mapDesktopServer(server: DesktopServer): Server {
  return {
    id: server.id,
    user_id: server.user_id || "local",
    name: server.name || undefined,
    host: server.host,
    port: server.port || 22,
    username: server.username,
    auth_method: server.auth_method === DesktopServerAuthMethod.DesktopServerAuthKey ? "key" : "password",
    password: server.password || undefined,
    private_key: server.private_key || undefined,
    group: server.group || undefined,
    tags: server.tags || [],
    status: server.status === "online" ? "online" : "offline",
    last_connected: server.last_connected || undefined,
    description: server.description || undefined,
    created_at: server.created_at,
    updated_at: server.updated_at,
  }
}

export function mapServerInput(input: Parameters<ServerConnectionConfigsApi["create"]>[0]): DesktopServerInput {
  return {
    name: input.name || "",
    host: input.host,
    port: input.port || 22,
    username: input.username,
    auth_method: input.auth_method === "key"
      ? DesktopServerAuthMethod.DesktopServerAuthKey
      : DesktopServerAuthMethod.DesktopServerAuthPassword,
    password: input.password || "",
    private_key: input.private_key || "",
    group: input.group || "",
    tags: input.tags || [],
    description: input.description || "",
  }
}

export function createDesktopServerApi(): ServerConnectionConfigsApi {
  return {
    async list(params) {
      const result = await DesktopServerService.List({
        page: params?.page,
        limit: params?.limit,
        group: params?.group,
        search: params?.search,
      })

      return {
        data: (result.data || []).map(mapDesktopServer),
        total: result.total,
        page: result.page,
        limit: result.limit,
      }
    },
    async create(input) {
      return mapDesktopServer(await DesktopServerService.Create(mapServerInput(input)))
    },
    async update(id, input) {
      const current = await DesktopServerService.GetById(id)

      return mapDesktopServer(await DesktopServerService.Update(id, mapServerInput({
        name: input.name ?? current.name ?? "",
        host: input.host ?? current.host,
        port: input.port ?? current.port ?? 22,
        username: input.username ?? current.username,
        auth_method: input.auth_method ?? (current.auth_method === DesktopServerAuthMethod.DesktopServerAuthKey ? "key" : "password"),
        password: input.password ?? current.password ?? "",
        private_key: input.private_key ?? current.private_key ?? "",
        group: input.group ?? current.group ?? "",
        tags: input.tags ?? current.tags ?? [],
        description: input.description ?? current.description ?? "",
      })))
    },
    async delete(id) {
      await DesktopServerService.Delete(id)
    },
    async reorder(serverIds) {
      await DesktopServerService.Reorder(serverIds)
    },
  }
}
