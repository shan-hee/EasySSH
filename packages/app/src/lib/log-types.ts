import type { components } from "@/generated/openapi"
export type AuditLogStatus =
  | "pending"
  | "running"
  | "success"
  | "failure"
  | "partial"
  | "canceled"
  | "timeout"
  | "warning"
  | "unknown"

export interface AuditLogSummary {
  source_table?: string
  source_id?: string
  resources?: components["schemas"]["ActivityResourceSnapshot"][]
  id: string
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
  /** 以下字段仅桌面端活动记录提供，用于表格中的服务器、进度与文件统计。 */
  server_name?: string
  attempt?: number
  progress?: number
  total_count?: number
  success_count?: number
  failure_count?: number
  bytes_total?: number
  bytes_processed?: number
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
