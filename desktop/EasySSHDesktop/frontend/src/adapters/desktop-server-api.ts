import type {
  AuthMethod,
  Server,
  ServerConnectionConfigsApi,
  WorkspaceTerminalCredentialSaveRequest,
} from "@easyssh/ssh-workspace/desktop"
import {
  primaryCredentialMethod,
  requiresPassword,
  requiresPrivateKey,
} from "@easyssh/ssh-workspace/desktop"
import {
  DesktopServerAuthMethod,
  DesktopServerService,
  type DesktopServer,
  type DesktopServerInput,
} from "../../bindings/github.com/easyssh/easyssh-desktop"
import { DESKTOP_LOCAL_DATA_USER_ID } from "./desktop-local-identity"
import { Call } from "@wailsio/runtime"

const desktopAuthMethodMap: Record<AuthMethod, DesktopServerAuthMethod> = {
  password: DesktopServerAuthMethod.DesktopServerAuthPassword,
  key: DesktopServerAuthMethod.DesktopServerAuthKey,
  password_keyboard: DesktopServerAuthMethod.DesktopServerAuthPasswordKeyboard,
  key_keyboard: DesktopServerAuthMethod.DesktopServerAuthKeyKeyboard,
  key_password: DesktopServerAuthMethod.DesktopServerAuthKeyPassword,
  key_password_keyboard: DesktopServerAuthMethod.DesktopServerAuthKeyPasswordKeyboard,
  password_key: DesktopServerAuthMethod.DesktopServerAuthPasswordKey,
  password_key_keyboard: DesktopServerAuthMethod.DesktopServerAuthPasswordKeyKeyboard,
  keyboard_interactive: DesktopServerAuthMethod.DesktopServerAuthKeyboardInteractive,
  keyboard: DesktopServerAuthMethod.DesktopServerAuthKeyboardInteractive,
}

export function fromDesktopAuthMethod(authMethod: DesktopServerAuthMethod | string): AuthMethod {
  return authMethod === DesktopServerAuthMethod.DesktopServerAuthKeyboardInteractiveAlias
    ? "keyboard_interactive"
    : desktopAuthMethodMap[authMethod as AuthMethod]
      ? authMethod as AuthMethod
      : "password"
}

export function toDesktopAuthMethod(authMethod?: AuthMethod | string): DesktopServerAuthMethod {
  return desktopAuthMethodMap[(authMethod || "password") as AuthMethod] ?? DesktopServerAuthMethod.DesktopServerAuthPassword
}

export function desktopAuthRequiresPassword(authMethod?: AuthMethod | string) {
  return requiresPassword(authMethod)
}

export function desktopAuthRequiresPrivateKey(authMethod?: AuthMethod | string) {
  return requiresPrivateKey(authMethod)
}

export function mapDesktopServer(server: DesktopServer): Server {
  return {
    id: server.id,
    user_id: server.user_id || DESKTOP_LOCAL_DATA_USER_ID,
    name: server.name || undefined,
    host: server.host,
    port: server.port || 22,
    username: server.username,
    auth_method: fromDesktopAuthMethod(server.auth_method),
    ssh_key_id: server.ssh_key_id,
    has_password: Boolean(server.has_password),
    has_private_key: Boolean(server.has_private_key),
    group: server.group || undefined,
    tags: server.tags || [],
    status: server.status === "online" ? "online" : "offline",
    last_connected: server.last_connected || undefined,
    description: server.description || undefined,
    os: server.os || undefined,
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
    auth_method: toDesktopAuthMethod(input.auth_method),
    password: input.password || "",
    private_key: input.private_key || "",
    password_set: passwordSet,
    private_key_set: privateKeySet,
    ssh_key_id: input.ssh_key_id ?? null,
    private_key_passphrase: input.private_key_passphrase,
    group: input.group || "",
    tags: input.tags || [],
    description: input.description || "",
  }
}

export function createDesktopServerApi(): ServerConnectionConfigsApi {
  return {
    sshKeys: {
      list: () => Call.ByName("main.DesktopServerService.ListSSHKeys"),
      import: input => Call.ByName("main.DesktopServerService.ImportSSHKey", input),
      delete: id => Call.ByName("main.DesktopServerService.DeleteSSHKey", id),
    },
    getStatistics: () => Call.ByName("main.DesktopServerService.GetStatistics"),
    async getById(id) { return mapDesktopServer(await DesktopServerService.GetById(id)) },
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
        auth_method: input.auth_method ?? fromDesktopAuthMethod(current.auth_method),
        group: input.group ?? current.group ?? "",
        tags: input.tags ?? current.tags ?? [],
        description: input.description ?? current.description ?? "",
      }

      if (Object.prototype.hasOwnProperty.call(input, "password")) {
        mergedInput.password = input.password ?? ""
      }
      mergedInput.ssh_key_id = input.ssh_key_id
      mergedInput.private_key_passphrase = input.private_key_passphrase
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
  password,
  privateKey,
  privateKeyPassphrase,
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

  if (password !== undefined) input.password = password
  if (privateKey !== undefined) input.private_key = privateKey
  if (password === undefined && privateKey === undefined) {
    if (primaryCredentialMethod(authMethod) === "key") input.private_key = secret
    else input.password = secret
  }

  input.private_key_passphrase = privateKeyPassphrase
  await DesktopServerService.Update(serverId, mapServerInput(input))
}

export async function markDesktopServerConnected(serverId: string): Promise<void> {
  await DesktopServerService.MarkConnected(serverId)
}
