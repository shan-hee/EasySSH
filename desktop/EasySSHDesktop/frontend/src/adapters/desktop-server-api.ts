import type {
  Server,
  ServerConnectionConfigsApi,
  WorkspaceTerminalCredentialSaveRequest,
} from "@easyssh/ssh-workspace/desktop"
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
    has_password: Boolean(server.has_password),
    has_private_key: Boolean(server.has_private_key),
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
  const passwordSet = Object.prototype.hasOwnProperty.call(input, "password") && input.password !== undefined
  const privateKeySet = Object.prototype.hasOwnProperty.call(input, "private_key") && input.private_key !== undefined

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
    password_set: passwordSet,
    private_key_set: privateKeySet,
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
      const mergedInput: Parameters<ServerConnectionConfigsApi["create"]>[0] = {
        name: input.name ?? current.name ?? "",
        host: input.host ?? current.host,
        port: input.port ?? current.port ?? 22,
        username: input.username ?? current.username,
        auth_method: input.auth_method ?? (current.auth_method === DesktopServerAuthMethod.DesktopServerAuthKey ? "key" : "password"),
        group: input.group ?? current.group ?? "",
        tags: input.tags ?? current.tags ?? [],
        description: input.description ?? current.description ?? "",
      }

      if (Object.prototype.hasOwnProperty.call(input, "password")) {
        mergedInput.password = input.password ?? ""
      }
      if (Object.prototype.hasOwnProperty.call(input, "private_key")) {
        mergedInput.private_key = input.private_key ?? ""
      }

      return mapDesktopServer(await DesktopServerService.Update(id, mapServerInput(mergedInput)))
    },
    async delete(id) {
      await DesktopServerService.Delete(id)
    },
    async reorder(serverIds) {
      await DesktopServerService.Reorder(serverIds)
    },
  }
}

export async function saveDesktopVerifiedCredential({
  serverId,
  authMethod,
  secret,
}: WorkspaceTerminalCredentialSaveRequest): Promise<void> {
  const current = await DesktopServerService.GetById(serverId)
  const input: Parameters<ServerConnectionConfigsApi["create"]>[0] = {
    name: current.name ?? "",
    host: current.host,
    port: current.port || 22,
    username: current.username,
    auth_method: authMethod,
    group: current.group ?? "",
    tags: current.tags ?? [],
    description: current.description ?? "",
  }

  if (authMethod === "password") {
    input.password = secret
  }
  if (authMethod === "key") {
    input.private_key = secret
  }

  await DesktopServerService.Update(serverId, mapServerInput(input))
}

export async function markDesktopServerConnected(serverId: string): Promise<void> {
  await DesktopServerService.MarkConnected(serverId)
}
