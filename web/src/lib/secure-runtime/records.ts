import { isServerConnected } from "./connection-state"
import type { SyncSnapshot } from "@/lib/sync/automerge"
import type { CreateServerRequest, Server, UpdateServerRequest, AuthMethod } from "@/lib/server-types"
import { currentWorkspace } from "./session"
import type { BrowserSSHCredentials } from "./browser-ssh"

export const configuration = "configuration"
export const orderKey = "order/00000000-0000-4000-8000-000000000001"
export const credentialsResource = "credentials"

export function scheduleSync() { void currentWorkspace().sync().catch(() => {}) }
export async function configSnapshot() { return currentWorkspace().snapshot("config", configuration) }
export function orderedIDs(snapshot: SyncSnapshot) {
  const ids = Object.keys(snapshot).filter((key) => key.startsWith("server/")).map((key) => key.slice(7)).sort()
  const available = new Set(ids)
  const order: unknown = JSON.parse(snapshot[orderKey]?.ids || "[]")
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) throw new Error("服务器排序数据无效")
  const result = order.filter((id: string) => available.delete(id)) as string[]
  return [...result, ...ids.filter((id) => available.has(id))]
}
export function serverFromRecord(id: string, record: Record<string, string>): Server {
  const connection = JSON.parse(record.connection)
  return { id, user_id: currentWorkspace().owner, ...connection, name: record.name, group: record.group,
    description: record.description, tags: JSON.parse(record.tags || "[]"), status: isServerConnected(id) ? "online" : "offline",
    created_at: record.created_at, updated_at: record.updated_at }
}
export async function saveServer(id: string, input: CreateServerRequest | UpdateServerRequest, create: boolean) {
  const workspace = currentWorkspace()
  if (input.ssh_key_id) {
    const { getLocalSSHKey } = await import("@/lib/api/ssh-keys")
    const key = await getLocalSSHKey(input.ssh_key_id)
    input = { ...input, private_key: key.private_key, private_key_passphrase: key.passphrase }
  }
  const secretFields = ["password", "private_key", "private_key_passphrase"] as const
  const secretChange = secretFields.some((field) => input[field] !== undefined)
  let connection = ""
  await workspace.editMany([
    { scope: "config", resource: configuration, edit(snapshot) {
      const old = snapshot[`server/${id}`]
      if (!create && !old) throw new Error("服务器不存在")
      const previous = old ? serverFromRecord(id, old) : { host: "", port: 22, username: "", auth_method: "password" as AuthMethod }
      const next = { ...previous, ...input }
      if (!next.host?.trim() || next.host.length > 255 || !next.username?.trim() || !Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw new Error("SSH 地址、用户名或端口无效")
      connection = JSON.stringify({ host: next.host, port: next.port, username: next.username, auth_method: next.auth_method })
      return { ...snapshot, [`server/${id}`]: {
        name: next.name || "", description: next.description || "", group: next.group || "", tags: JSON.stringify(next.tags || []),
        connection, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
      } }
    } },
    ...(secretChange ? [{ scope: "credentials" as const, resource: credentialsResource, edit(snapshot: SyncSnapshot) {
      const previous = JSON.parse(snapshot[`value/${id}`]?.content || "{}")
      if (previous.connection && previous.connection !== connection) { previous.password = ""; previous.private_key = ""; previous.private_key_passphrase = "" }
      previous.connection = connection
      for (const field of secretFields) if (input[field] !== undefined) previous[field] = input[field]
      return { ...snapshot, [`value/${id}`]: { content: JSON.stringify(previous) } }
    } }] : []),
  ])
  scheduleSync()
  const snapshot = await configSnapshot()
  return serverFromRecord(id, snapshot[`server/${id}`])
}
export async function connectionCredentials(id: string): Promise<BrowserSSHCredentials> {
  const workspace = currentWorkspace()
  if (!workspace.view?.scopes.includes("credentials")) return { password: "", private_key: "", passphrase: "" }
  if ((await workspace.conflicts("credentials", credentialsResource)).some((conflict) => conflict.key === `value/${id}`)) throw new Error("此服务器的凭据存在冲突，请在加密工作区选择版本")
  const snapshot = await workspace.snapshot("credentials", credentialsResource)
  const value = JSON.parse(snapshot[`value/${id}`]?.content || "{}")
  const connection = (await configSnapshot())[`server/${id}`]?.connection
  if (value.connection !== connection) return { password: "", private_key: "", passphrase: "" }
  return { password: value.password || "", private_key: value.private_key || "", passphrase: value.private_key_passphrase || "" }
}
