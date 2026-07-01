import type {
  SshWorkspaceActivityLogAdapter,
  SshWorkspaceTransferHistoryAdapter,
  WorkspaceActivityLogItem,
  WorkspaceActivityLogListResult,
  WorkspaceActivityLogStatistics,
  WorkspaceTransferHistoryItem,
  WorkspaceTransferHistoryListResult,
  WorkspaceTransferHistoryStatistics,
} from "./workspace"
import type {
  OperationRecord,
  OperationRecordListParams,
  OperationRecordListResponse,
  OperationRecordStatistics,
  OperationRecordStatus,
} from "@/lib/api/operation-records"
import type {
  AuditLog,
  AuditLogListResponse,
  AuditLogStatisticsResponse,
} from "@/lib/log-types"

export interface OperationRecordsTransferApiLike {
  list: (params?: OperationRecordListParams) => Promise<OperationRecordListResponse>
  getById: (id: string) => Promise<OperationRecord>
  getStatistics: (params?: Pick<OperationRecordListParams, "type" | "start_date" | "end_date">) => Promise<OperationRecordStatistics>
}

function parseOperationRecordDetail(record: OperationRecord): Record<string, unknown> {
  if (!record.detail_json) {
    return {}
  }
  try {
    const parsed = JSON.parse(record.detail_json)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function detailString(detail: Record<string, unknown>, key: string): string | undefined {
  const value = detail[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

function mapOperationRecordStatusToWorkspaceTransferStatus(status: OperationRecordStatus): WorkspaceTransferHistoryItem["status"] {
  if (status === "success") {
    return "completed"
  }
  if (status === "pending") {
    return "pending"
  }
  if (status === "running") {
    return "transferring"
  }
  return "failed"
}

function mapOperationRecordActionToTransferType(action: string): WorkspaceTransferHistoryItem["transferType"] {
  if (action.includes("download")) {
    return "download"
  }
  if (action.includes("transfer")) {
    return "transfer"
  }
  return "upload"
}

function mapWorkspaceTransferHistoryStatusToOperationRecordStatus(
  status?: WorkspaceTransferHistoryItem["status"],
): OperationRecordStatus | undefined {
  if (status === "completed") {
    return "success"
  }
  if (status === "failed") {
    return "failure"
  }
  if (status === "transferring") {
    return "running"
  }
  return status
}

export function mapOperationRecordToWorkspaceHistoryItem(
  record: OperationRecord,
): WorkspaceTransferHistoryItem {
  const detail = parseOperationRecordDetail(record)
  const sourcePath = detailString(detail, "source_path") ?? record.resource
  const destPath = detailString(detail, "dest_path") ?? detailString(detail, "target_path") ?? ""
  const fileName = detailString(detail, "file_name") ?? record.title ?? sourcePath.split("/").filter(Boolean).pop() ?? record.action

  return {
    id: record.id,
    serverId: record.server_id ?? "",
    sessionId: detailString(detail, "session_id"),
    transferType: mapOperationRecordActionToTransferType(record.action),
    sourcePath,
    destPath,
    fileName,
    fileSizeBytes: record.bytes_total,
    status: mapOperationRecordStatusToWorkspaceTransferStatus(record.status),
    progress: record.progress,
    bytesTransferred: record.bytes_processed,
    startedAt: record.started_at,
    completedAt: record.finished_at,
    durationSeconds: record.duration_ms ? Math.round(record.duration_ms / 1000) : undefined,
    speedBytesPerSecond: record.speed_bps,
    errorMessage: record.error_message,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

export function mapOperationRecordListToWorkspaceHistoryResult(
  response: OperationRecordListResponse,
): WorkspaceTransferHistoryListResult {
  return {
    items: response.records.map(mapOperationRecordToWorkspaceHistoryItem),
    total: response.total,
    page: response.page,
    pageSize: response.page_size,
    totalPages: response.total_pages,
  }
}

export function mapOperationRecordStatisticsToWorkspaceStatistics(
  statistics: OperationRecordStatistics,
): WorkspaceTransferHistoryStatistics {
  return {
    totalTransfers: statistics.total,
    completedTransfers: statistics.success_count,
    failedTransfers: statistics.failure_count,
    totalBytesUploaded: 0,
    totalBytesDownloaded: 0,
    byType: statistics.by_type,
    byStatus: statistics.by_status,
  }
}

export function createWorkspaceTransferHistoryAdapter(
  api: OperationRecordsTransferApiLike,
): SshWorkspaceTransferHistoryAdapter {
  return {
    async list(params) {
      const response = await api.list({
        page: params?.page,
        page_size: params?.limit,
        status: mapWorkspaceTransferHistoryStatusToOperationRecordStatus(params?.status),
        type: "transfer",
        action: params?.transferType,
        server_id: params?.serverId,
      })
      return mapOperationRecordListToWorkspaceHistoryResult(response)
    },
    async getById(id) {
      return mapOperationRecordToWorkspaceHistoryItem(await api.getById(id))
    },
    async getStatistics() {
      return mapOperationRecordStatisticsToWorkspaceStatistics(await api.getStatistics({ type: "transfer" }))
    },
  }
}

export interface WorkspaceLogsApiLike {
  list: (params?: {
    page?: number
    page_size?: number
    user_id?: string
    server_id?: string
    action?: string
    category?: "activity" | "audit"
    status?: string
    start_date?: string
    end_date?: string
  }) => Promise<AuditLogListResponse>
  getById: (id: string) => Promise<AuditLog>
  getStatistics: (params?: {
    category?: "activity" | "audit"
    start_date?: string
    end_date?: string
  }) => Promise<AuditLogStatisticsResponse>
}

export function mapAuditLogToWorkspaceActivityLogItem(log: AuditLog): WorkspaceActivityLogItem {
  return {
    id: log.id,
    action: log.action,
    resource: log.resource,
    status: log.status,
    serverId: log.server_id,
    durationMs: log.duration,
    detail: log.error_msg || log.details,
    createdAt: log.created_at,
  }
}

export function mapAuditLogListToWorkspaceActivityResult(
  response: AuditLogListResponse,
): WorkspaceActivityLogListResult {
  return {
    items: response.logs.map(mapAuditLogToWorkspaceActivityLogItem),
    total: response.total,
    page: response.page,
    pageSize: response.page_size,
    totalPages: response.total_pages,
  }
}

export function mapAuditLogStatisticsToWorkspaceActivityStatistics(
  statistics: AuditLogStatisticsResponse,
): WorkspaceActivityLogStatistics {
  return {
    total: statistics.total_logs,
    successCount: statistics.success_count,
    failureCount: statistics.failure_count,
    byAction: statistics.action_stats,
  }
}

export function createWorkspaceActivityLogAdapter(
  api: WorkspaceLogsApiLike,
): SshWorkspaceActivityLogAdapter {
  return {
    async list(params) {
      const response = await api.list({
        page: params?.page,
        page_size: params?.limit,
        category: "activity",
        action: params?.action,
        server_id: params?.serverId,
        status: params?.status,
        start_date: params?.startDate,
        end_date: params?.endDate,
      })
      return mapAuditLogListToWorkspaceActivityResult(response)
    },
    async getById(id) {
      return mapAuditLogToWorkspaceActivityLogItem(await api.getById(id))
    },
    async getStatistics(params) {
      return mapAuditLogStatisticsToWorkspaceActivityStatistics(await api.getStatistics({
        category: "activity",
        start_date: params?.startDate,
        end_date: params?.endDate,
      }))
    },
  }
}
