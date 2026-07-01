export type AuditLogStatus =
  | "pending"
  | "running"
  | "success"
  | "failure"
  | "partial"
  | "canceled"
  | "timeout"
  | "warning"

export interface AuditLog {
  id: string
  user_id: string
  username: string
  server_id?: string
  type?: "connection" | "transfer" | "execution" | "audit"
  action: string
  category: "activity" | "audit"
  resource: string
  source?: string
  status: AuditLogStatus
  ip: string
  user_agent: string
  details?: string
  error_msg?: string
  duration?: number
  created_at: string
}

export interface AuditLogListResponse {
  logs: AuditLog[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface AuditLogStatisticsResponse {
  total_logs: number
  success_count: number
  failure_count: number
  action_stats: Record<string, number>
  recent_failures: AuditLog[]
  top_users: Array<{
    user_id: string
    username: string
    count: number
  }>
}

export interface AuditLogCleanupResponse {
  deleted_count: number
  retention_days: number
}

export interface AuditLogListParams {
  page?: number
  page_size?: number
  user_id?: string
  server_id?: string
  type?: "connection" | "transfer" | "execution" | "audit" | Array<"connection" | "transfer" | "execution" | "audit">
  action?: string
  category?: "activity" | "audit" | Array<"activity" | "audit">
  status?: string | string[]
  source?: string
  ip?: string
  keyword?: string
  q?: string
  start_date?: string
  end_date?: string
  sort_by?: string
  sort_order?: "asc" | "desc"
}
