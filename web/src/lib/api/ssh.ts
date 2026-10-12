import { localSSHSessions, closeLocalSSHSession } from "@/lib/secure-runtime/terminal"

/**
 * SSH会话信息
 */
export interface SSHSession {
  id: string
  server_id: string
  user_id: string
  server_name?: string
  status: "active" | "closed"
  started_at: string
  ended_at?: string
  duration?: number
  commands_count?: number
}

/**
 * SSH会话列表响应
 */
export interface SSHSessionListResponse {
  data: SSHSession[]
  total: number
}

/**
 * SSH统计响应
 */
export interface SSHStatisticsResponse {
  total_sessions: number
  active_sessions: number
  total_commands: number
  avg_session_duration: number
}

/**
 * SSH API 服务
 */
export const sshApi = {
 async listSessions(params?: { server_id?: string; status?: string; limit?: number; offset?: number }): Promise<SSHSessionListResponse> {
  const data = localSSHSessions().filter((s) => (!params?.server_id || s.server_id === params.server_id) && (!params?.status || s.status === params.status))
  const offset = params?.offset || 0; return { data: data.slice(offset, offset + (params?.limit || 100)), total: data.length }
 },
 async getSession(id: string): Promise<SSHSession> { const session = localSSHSessions().find((s) => s.id === id); if (!session) throw new Error("本机会话不存在"); return session },
 async closeSession(id: string): Promise<void> { closeLocalSSHSession(id) },
 async getStatistics(): Promise<SSHStatisticsResponse> { const active = localSSHSessions().length; return { total_sessions: active, active_sessions: active, total_commands: 0, avg_session_duration: 0 } },
}
