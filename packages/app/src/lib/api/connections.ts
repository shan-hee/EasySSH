import { apiFetch, isApiError } from "@/lib/api-client"
import { getOptionalPlatformTransport } from "@/contracts/platform-transport"
import type { components } from "@/generated/openapi"

export type ConnectionMode = components["schemas"]["ConnectionMode"]
export type ConnectionInfo = components["schemas"]["ConnectionInfo"]

/** 文件、Docker 与系统信息等资源请求通过该请求头声明所属的逻辑连接。 */
export const CONNECTION_HEADER = "X-EasySSH-Connection"

export const connectionsApi = {
  create(serverId: string, mode: ConnectionMode): Promise<ConnectionInfo> {
    return apiFetch<ConnectionInfo>("/connections", {
      method: "POST",
      body: { server_id: serverId, mode },
      retry: false,
    })
  },

  heartbeat(id: string): Promise<ConnectionInfo> {
    return apiFetch<ConnectionInfo>(`/connections/${encodeURIComponent(id)}/heartbeat`, { method: "POST", retry: false })
  },

  close(id: string): Promise<void> {
    return apiFetch<void>(`/connections/${encodeURIComponent(id)}`, { method: "DELETE", retry: false })
  },
}

/** 逻辑连接已被服务端回收：空闲超时、会话结束或资源变更。 */
export function isConnectionUnavailable(error: unknown): boolean {
  if (!isApiError(error) || error.status !== 403) return false
  const detail = error.detail as { error?: unknown } | null
  return detail?.error === "connection_unavailable"
}

// 最后一个使用者释放后保留片刻，连续的目录浏览与操作复用同一连接。
const RELEASE_DELAY_MS = 10_000

interface SharedConnection {
  info: Promise<ConnectionInfo>
  refs: number
  heartbeat?: ReturnType<typeof setInterval>
  releaseTimer?: ReturnType<typeof setTimeout>
}

const sharedConnections = new Map<string, SharedConnection>()
let unsubscribeCredentials: (() => void) | null = null

function connectionKey(serverId: string, mode: ConnectionMode) {
  return `${mode}:${serverId}`
}

function discard(key: string, entry: SharedConnection, close: boolean) {
  if (sharedConnections.get(key) === entry) sharedConnections.delete(key)
  clearInterval(entry.heartbeat)
  clearTimeout(entry.releaseTimer)
  if (close) {
    void entry.info.then((info) => connectionsApi.close(info.id)).catch(() => undefined)
  }
}

/** 会话结束时连接随之失效，只清理本地计时器。 */
function watchCredentials() {
  if (unsubscribeCredentials) return
  const transport = getOptionalPlatformTransport()
  if (!transport) return
  unsubscribeCredentials = transport.subscribeCredentials(() => {
    if (transport.hasCredentials()) return
    for (const [key, entry] of sharedConnections) discard(key, entry, false)
  })
}

function acquire(serverId: string, mode: ConnectionMode): { info: Promise<ConnectionInfo>; release: () => void } {
  watchCredentials()
  const key = connectionKey(serverId, mode)
  let entry = sharedConnections.get(key)
  if (!entry) {
    const created: SharedConnection = { info: connectionsApi.create(serverId, mode), refs: 0 }
    sharedConnections.set(key, created)
    created.info.then((info) => {
      if (sharedConnections.get(key) !== created) return
      created.heartbeat = setInterval(() => {
        connectionsApi.heartbeat(info.id).catch(() => discard(key, created, false))
      }, Math.max(5, info.heartbeat_seconds) * 1000)
    }, () => discard(key, created, false))
    entry = created
  }
  const current = entry
  clearTimeout(current.releaseTimer)
  current.releaseTimer = undefined
  current.refs += 1

  let released = false
  return {
    info: current.info,
    release: () => {
      if (released) return
      released = true
      current.refs -= 1
      if (current.refs > 0 || sharedConnections.get(key) !== current) return
      current.releaseTimer = setTimeout(() => discard(key, current, true), RELEASE_DELAY_MS)
    },
  }
}

/**
 * 在同一服务器的共享逻辑连接上执行资源请求。连接被服务端回收时重建并重试一次。
 */
export async function withServerConnection<T>(
  serverId: string,
  mode: ConnectionMode,
  run: (connectionId: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const lease = acquire(serverId, mode)
    try {
      const info = await lease.info
      return await run(info.id)
    } catch (error) {
      const entry = sharedConnections.get(connectionKey(serverId, mode))
      if (attempt > 0 || !isConnectionUnavailable(error)) throw error
      if (entry) discard(connectionKey(serverId, mode), entry, false)
    } finally {
      lease.release()
    }
  }
}

/** 页面持有连接期间保持心跳，例如文件管理器或 Docker 面板打开时；返回释放函数。 */
export function holdServerConnection(serverId: string, mode: ConnectionMode): () => void {
  const lease = acquire(serverId, mode)
  lease.info.catch(() => undefined)
  return lease.release
}

/** 资源请求声明所属逻辑连接的请求头。 */
export function connectionHeader(connectionId: string): Record<string, string> {
  return { [CONNECTION_HEADER]: connectionId }
}
