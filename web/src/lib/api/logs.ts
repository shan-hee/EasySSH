import { apiFetch } from "@/lib/api-client"
import type {
  AuditLog,
  AuditLogCleanupResponse,
  AuditLogListParams,
  AuditLogListResponse,
  AuditLogStatisticsResponse,
} from "@/lib/log-types"

export type {
  AuditLog,
  AuditLogCleanupResponse,
  AuditLogListParams,
  AuditLogListResponse,
  AuditLogStatisticsResponse,
  AuditLogStatus,
} from "@/lib/log-types"

function buildQueryParams(params?: object) {
  const queryParams = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      const stringValue = Array.isArray(value) ? value.join(",") : String(value)
      if (stringValue !== "") {
        queryParams.set(key, stringValue)
      }
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
