import type {
  AuthMethod,
  Server,
  ServerConnectionConfigsApi,
  WorkspaceTerminalCredentialSaveRequest,
} from "@easyssh/app/desktop"
import {
  primaryCredentialMethod,
  requiresPassword,
  requiresPrivateKey,
} from "@easyssh/app/desktop"
import {
  DesktopServerAuthMethod,
  DesktopServerService,
} from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"
import type {
  Server as DesktopServer,
  ServerAuthMethod,
  ServerGroup,
  ServerCreate,
  ServerUpdate,
} from "../../bindings/github.com/easyssh/shared/protocol/models"
import { requestDesktopSync } from "./desktop-sync"

type SSHKeyApi = ServerConnectionConfigsApi["sshKeys"]
type SSHKey = Awaited<ReturnType<SSHKeyApi["list"]>>[number]

export const desktopSSHKeyApi: SSHKeyApi = {
  list: async () => await DesktopServerService.ListSSHKeys() as SSHKey[],
  async import(input) {
    const key = await DesktopServerService.ImportSSHKey({
      ...input,
      passphrase: input.passphrase ?? "",
    })
    requestDesktopSync()
    return key as SSHKey
  },
  async delete(id) {
    await DesktopServerService.DeleteSSHKey(id)
    requestDesktopSync()
  },
}

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
    name: server.name || undefined,
    host: server.host,
    port: server.port || 22,
    username: server.username,
    auth_method: fromDesktopAuthMethod(server.auth_method || "password"),
    ssh_key_id: server.ssh_key_id ?? null,
    has_password: Boolean(server.has_password),
    has_private_key: Boolean(server.has_private_key),
    group: server.group || undefined,
    group_id: server.group_id || undefined,
    tags: server.tags ?? [],
    status: server.status === "online" ? "online" : "offline",
    last_connected: server.last_connected ? String(server.last_connected) : undefined,
    description: server.description || undefined,
    os: server.os || undefined,
    created_at: String(server.created_at ?? ""),
    updated_at: String(server.updated_at ?? ""),
  }
}

// 桌面服务与实例使用同一份服务器契约，认证方式枚举值一致。
export function createDesktopServerApi(): ServerConnectionConfigsApi {
  return {
    sshKeys: desktopSSHKeyApi,
    groups: {
      async list() {
        const groups: ServerGroup[] = []
        for (let page = 1; ; page++) {
          const result = await DesktopServerService.ListGroups(page, 100)
          groups.push(...(result?.items ?? []))
          if (!result || result.items.length === 0 || groups.length >= result.total) return groups
        }
      },
      async create(name) {
        const group = await DesktopServerService.CreateGroup({ name })
        requestDesktopSync()
        return group
      },
    },
    getStatistics: async () => {
      const statistics = await DesktopServerService.GetStatistics()
      return {
        total: statistics.total,
        online: statistics.online ?? undefined,
        offline: statistics.offline ?? undefined,
        connected_servers: statistics.connected_servers ?? undefined,
        by_group: compactCounts(statistics.by_group),
        by_tag: compactCounts(statistics.by_tag),
      }
    },
    async getById(id) { return mapDesktopServer(await DesktopServerService.GetById(id)) },
    async list(params) {
      const result = await DesktopServerService.List({
        page: params?.page,
        limit: params?.limit,
        group_id: params?.groupId,
        q: params?.search,
        tag: params?.tag,
      })

      return {
        data: (result.data || []).map(mapDesktopServer),
        total: result.total,
        page: result.page,
        limit: result.limit,
        total_pages: result.total_pages,
      }
    },
    async create(input) {
      const server = await DesktopServerService.Create({ ...input, auth_method: input.auth_method as ServerAuthMethod } as ServerCreate)
      requestDesktopSync()
      return mapDesktopServer(server)
    },
    async update(id, input) {
      const server = await DesktopServerService.Update(id, {
        ...input,
        auth_method: input.auth_method as ServerAuthMethod | undefined,
      } as ServerUpdate)
      requestDesktopSync()
      return mapDesktopServer(server)
    },
    async delete(id) {
      await DesktopServerService.Delete(id)
      requestDesktopSync()
    },
    async reorder(serverIds) {
      await DesktopServerService.Reorder({ server_ids: serverIds })
      requestDesktopSync()
    },
  }
}

function compactCounts(counts: { [key: string]: number | undefined }): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter((entry): entry is [string, number] => entry[1] !== undefined))
}

/** 连接验证成功的凭据按实例相同的规则保存：只改认证相关字段。 */
export async function saveDesktopVerifiedCredential({
  serverId,
  authMethod,
  secret,
  password,
  privateKey,
  privateKeyPassphrase,
}: WorkspaceTerminalCredentialSaveRequest): Promise<void> {
  const input: ServerUpdate = {
    auth_method: authMethod as ServerAuthMethod,
    verified_connection_credential: true,
    private_key_passphrase: privateKeyPassphrase ?? "",
  }
  if (password !== undefined) input.password = password
  if (privateKey !== undefined) input.private_key = privateKey
  if (password === undefined && privateKey === undefined) {
    if (primaryCredentialMethod(authMethod) === "key") input.private_key = secret
    else input.password = secret
  }

  await DesktopServerService.Update(serverId, input)
  requestDesktopSync()
}
