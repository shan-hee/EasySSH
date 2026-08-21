export type AuditLogStatus =
  | "pending"
  | "running"
  | "success"
  | "failure"
  | "partial"
  | "canceled"
  | "timeout"
  | "warning"

export interface AuditLogSummary {
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
  error_msg?: string
  duration?: number
  created_at: string
}

export interface AuditLog extends AuditLogSummary {
  user_agent: string
  details?: string
}

export interface AuditLogListResponse {
  logs: AuditLogSummary[]
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
