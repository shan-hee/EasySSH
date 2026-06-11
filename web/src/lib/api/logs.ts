import { apiFetch } from "@/lib/api-client"

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
  type?: "connection" | "transfer" | "execution" | "audit"
  action?: string
  category?: "activity" | "audit"
  status?: string
  source?: string
  ip?: string
  keyword?: string
  q?: string
  start_date?: string
  end_date?: string
  sort_by?: string
  sort_order?: "asc" | "desc"
}

function buildQueryParams(params?: object) {
  const queryParams = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      queryParams.set(key, String(value))
    }
  })
  return queryParams
}

export const logsApi = {
  async list(params?: AuditLogListParams): Promise<AuditLogListResponse> {
    const queryParams = buildQueryParams(params)
    const url = `/logs${queryParams.toString() ? `?${queryParams}` : ""}`
    return apiFetch<AuditLogListResponse>(url)
  },

  async getById(id: string): Promise<AuditLog> {
    return apiFetch<AuditLog>(`/logs/${id}`)
  },

  async getStatistics(params?: {
    category?: "activity" | "audit"
    start_date?: string
    end_date?: string
  }): Promise<AuditLogStatisticsResponse> {
    const queryParams = new URLSearchParams()
    if (params?.category) queryParams.set("category", params.category)
    if (params?.start_date) queryParams.set("start_date", params.start_date)
    if (params?.end_date) queryParams.set("end_date", params.end_date)

    const url = `/logs/statistics${queryParams.toString() ? `?${queryParams}` : ""}`
    return apiFetch<AuditLogStatisticsResponse>(url)
  },

  async cleanup(retentionDays: number): Promise<AuditLogCleanupResponse> {
    const queryParams = new URLSearchParams()
    queryParams.set("retention_days", retentionDays.toString())

    return apiFetch<AuditLogCleanupResponse>(`/logs/cleanup?${queryParams.toString()}`, {
      method: "DELETE",
      retry: false,
    })
  },
}
