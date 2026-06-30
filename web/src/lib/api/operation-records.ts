import { apiFetch } from "@/lib/api-client"

export type OperationRecordType = "connection" | "transfer" | "execution" | "audit"
export type OperationRecordCategory = "activity" | "audit"
export type OperationRecordStatus =
  | "pending"
  | "running"
  | "success"
  | "failure"
  | "partial"
  | "canceled"
  | "timeout"
  | "warning"

export interface OperationRecord {
  id: string
  user_id: string
  username: string
  type: OperationRecordType
  category: OperationRecordCategory
  action: string
  status: OperationRecordStatus
  server_id?: string
  server_name: string
  title: string
  resource: string
  source: string
  ip: string
  user_agent: string
  started_at?: string
  finished_at?: string
  duration_ms: number
  progress: number
  total_count: number
  success_count: number
  failure_count: number
  bytes_total: number
  bytes_processed: number
  speed_bps: number
  error_message?: string
  detail_json?: string
  source_table: string
  source_id: string
  created_at: string
  updated_at: string
}

export interface OperationRecordListResponse {
  records: OperationRecord[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface OperationRecordStatistics {
  total: number
  success_count: number
  failure_count: number
  running_count: number
  by_type: Record<string, number>
  by_status: Record<string, number>
}

export interface OperationRecordListParams {
  page?: number
  page_size?: number
  type?: OperationRecordType | OperationRecordType[]
  category?: OperationRecordCategory | OperationRecordCategory[]
  action?: string
  status?: OperationRecordStatus | OperationRecordStatus[]
  server_id?: string
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
      const stringValue = Array.isArray(value) ? value.join(",") : String(value)
      if (stringValue !== "") {
        queryParams.set(key, stringValue)
      }
    }
  })
  return queryParams
}

export const operationRecordsApi = {
  async list(params?: OperationRecordListParams): Promise<OperationRecordListResponse> {
    const queryParams = buildQueryParams(params)
    const url = `/operation-records${queryParams.toString() ? `?${queryParams}` : ""}`
    return apiFetch<OperationRecordListResponse>(url)
  },

  async getById(id: string): Promise<OperationRecord> {
    return apiFetch<OperationRecord>(`/operation-records/${id}`)
  },

  async getStatistics(params?: Pick<OperationRecordListParams, "type" | "category" | "start_date" | "end_date">): Promise<OperationRecordStatistics> {
    const queryParams = buildQueryParams(params)
    const url = `/operation-records/statistics${queryParams.toString() ? `?${queryParams}` : ""}`
    return apiFetch<OperationRecordStatistics>(url)
  },
}
