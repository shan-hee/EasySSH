import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"
import { connectionsApi } from "@/lib/api/connections"
import type { SshWorkspaceAuthTicketProvider } from "@/lib/session/workspace"
import type { StreamTicketOptions } from "@/lib/session/terminal-types"

export type AccessTicketType =
  | "ws_vnc" | "ws_rdp"
  | "ws_terminal"
  | "ws_monitor"
  | "ws_sftp_auth"
  | "transfer_artifact"
  | "instance_backup_download"

export type AccessTicketInput = Omit<components["schemas"]["AccessTicketInput"], "type"> & {
  type: AccessTicketType
}

/**
 * 签发一次性票据，用于 WebSocket 握手与浏览器原生下载等无法附带会话请求头的场景。
 * WebSocket 票据需绑定逻辑连接。
 */
export async function createAccessTicket(input: AccessTicketInput): Promise<string> {
  const result = await apiFetch<components["schemas"]["AccessTicket"]>("/access/tickets", {
    method: "POST",
    body: input,
    retry: false,
    timeout: 10000,
  })
  return result.ticket
}

/**
 * 监控可附属于已有终端连接，独立流才申请新名额。
 * 新连接随流的取消信号释放，包括票据已签发但 WebSocket 尚未完成握手的情况。
 */
export async function createStreamTicket(type: "ws_terminal" | "ws_monitor", serverId: string, options: StreamTicketOptions = {}): Promise<string> {
  const { signal } = options
  signal?.throwIfAborted()
  const borrowed = type === "ws_monitor" ? options.connectionId : undefined
  const connectionId = borrowed ?? (await connectionsApi.create(serverId, type === "ws_terminal" ? "terminal" : "monitor")).id
  let released = false
  const release = () => {
    if (released || borrowed) return
    released = true
    void connectionsApi.close(connectionId).catch(() => undefined)
  }
  signal?.addEventListener("abort", release, { once: true })
  try {
    signal?.throwIfAborted()
    const ticket = await createAccessTicket({ type, server_id: serverId, connection_id: connectionId })
    signal?.throwIfAborted()
    options.onConnection?.(connectionId)
    return ticket
  } catch (error) {
    signal?.removeEventListener("abort", release)
    release()
    throw error
  }
}

/** 工作区使用的票据提供方：流票据自带逻辑连接，其余票据按载荷签发。 */
export const workspaceAccessTicketProvider: SshWorkspaceAuthTicketProvider = (scope, payload, options) => {
  if ((scope === "ws_terminal" || scope === "ws_monitor") && typeof payload?.server_id === "string") {
    return createStreamTicket(scope, payload.server_id, options)
  }
  return createAccessTicket({ ...payload, type: scope as AccessTicketType })
}
