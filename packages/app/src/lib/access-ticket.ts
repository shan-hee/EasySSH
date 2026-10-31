import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"
import { connectionsApi } from "@/lib/api/connections"
import type { SshWorkspaceAuthTicketProvider } from "@/lib/session/workspace"

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
 * 为终端或监控流签发握手票据。每个流使用独立的逻辑连接，流结束时服务端随之关闭；
 * 票据签发失败时立即关闭连接，握手失败的连接由服务端在空闲超时后回收。
 */
export async function createStreamTicket(type: "ws_terminal" | "ws_monitor", serverId: string): Promise<string> {
  const connection = await connectionsApi.create(serverId, type === "ws_terminal" ? "terminal" : "monitor")
  try {
    return await createAccessTicket({ type, server_id: serverId, connection_id: connection.id })
  } catch (error) {
    void connectionsApi.close(connection.id).catch(() => undefined)
    throw error
  }
}

/** 工作区使用的票据提供方：流票据自带逻辑连接，其余票据按载荷签发。 */
export const workspaceAccessTicketProvider: SshWorkspaceAuthTicketProvider = (scope, payload) => {
  if ((scope === "ws_terminal" || scope === "ws_monitor") && typeof payload?.server_id === "string") {
    return createStreamTicket(scope, payload.server_id)
  }
  return createAccessTicket({ ...payload, type: scope as AccessTicketType })
}
