import type {
  SshWorkspaceActivityLogAdapter,
  SshWorkspaceTransferHistoryAdapter,
  WorkspaceActivityLogRecordInput,
  WorkspaceTransferHistoryItem,
  WorkspaceTransferHistoryStatistics,
  WorkspaceTransferHistoryType,
} from "@easyssh/ssh-workspace/desktop"
import {
  ActivityLogService,
  DesktopActivityLogStatus,
} from "../../bindings/github.com/easyssh/easyssh-desktop"
import { mapNumberRecord } from "./desktop-adapter-utils"
import {
  mapDesktopActivityLogItem,
  mapWorkspaceActivityLogStatusToDesktop,
} from "./desktop-activity-log-mappers"

const desktopTransferActions = ["sftp_upload", "sftp_download", "sftp_transfer"] as const

export function createDesktopActivityLogAdapter(): SshWorkspaceActivityLogAdapter {
  return {
    async list(params) {
      const result = await ActivityLogService.List({
        page: params?.page,
        limit: params?.limit,
        action: params?.action,
        serverId: params?.serverId,
        status: params?.status ? mapWorkspaceActivityLogStatusToDesktop(params.status) : undefined,
        startDate: params?.startDate,
        endDate: params?.endDate,
      })

      return {
        items: (result.items || []).map(mapDesktopActivityLogItem),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      }
    },
    async getById(id) {
      return mapDesktopActivityLogItem(await ActivityLogService.GetById(id))
    },
    async getStatistics(params) {
      const statistics = await ActivityLogService.GetStatistics({
        startDate: params?.startDate,
        endDate: params?.endDate,
      })

      return {
        total: statistics.total,
        successCount: statistics.successCount,
        failureCount: statistics.failureCount,
        byAction: mapNumberRecord(statistics.byAction),
      }
    },
    async record(input: WorkspaceActivityLogRecordInput) {
      return mapDesktopActivityLogItem(await ActivityLogService.Record({
        action: input.action,
        resource: input.resource,
        status: mapWorkspaceActivityLogStatusToDesktop(input.status),
        serverId: input.serverId,
        durationMs: input.durationMs,
        detail: input.detail,
      }))
    },
  }
}

export function createDesktopTransferHistoryAdapter(): SshWorkspaceTransferHistoryAdapter {
  return {
    async list(params) {
      const page = Math.max(1, params?.page ?? 1)
      const pageSize = Math.max(1, Math.min(100, params?.limit ?? 20))
      const actions = params?.transferType
        ? [desktopActionFromTransferType(params.transferType)]
        : [...desktopTransferActions]

      const actionItems = await Promise.all(actions.map((action) => listDesktopActivityItems({
        action,
        serverId: params?.serverId,
      })))
      const items = actionItems
        .flat()
        .map(mapDesktopActivityLogItemToTransferHistoryItem)
        .filter((item) => !params?.status || item.status === params.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))

      const start = (page - 1) * pageSize
      const pagedItems = items.slice(start, start + pageSize)
      const total = items.length
      return {
        items: pagedItems,
        total,
        page,
        pageSize,
        totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
      }
    },
    async getById(id) {
      return mapDesktopActivityLogItemToTransferHistoryItem(await ActivityLogService.GetById(id))
    },
    async getStatistics() {
      const actionItems = await Promise.all(desktopTransferActions.map((action) => listDesktopActivityItems({
        action,
      })))
      const items = actionItems
        .flat()
        .map(mapDesktopActivityLogItemToTransferHistoryItem)
      return createDesktopTransferHistoryStatistics(items)
    },
  }
}

async function listDesktopActivityItems(params: {
  action: string
  serverId?: string
}) {
  const limit = 100
  let page = 1
  const items: Array<Awaited<ReturnType<typeof ActivityLogService.GetById>>> = []

  for (;;) {
    const result = await ActivityLogService.List({
      page,
      limit,
      action: params.action,
      serverId: params.serverId,
    })
    items.push(...(result.items || []))
    if (page >= (result.totalPages || 0) || (result.items || []).length === 0) {
      break
    }
    page += 1
  }

  return items
}

export async function recordDesktopTerminalOpened(server: {
  id: string
  username: string
  host: string
  port: number
}): Promise<void> {
  await ActivityLogService.Record({
    action: "ssh_connect",
    resource: `${server.username}@${server.host}:${server.port}`,
    status: DesktopActivityLogStatus.DesktopActivityLogSuccess,
    serverId: server.id,
    detail: "Desktop command terminal opened",
  })
}

function desktopActionFromTransferType(type: WorkspaceTransferHistoryType) {
  if (type === "download") return "sftp_download"
  if (type === "transfer") return "sftp_transfer"
  return "sftp_upload"
}

function desktopTransferTypeFromAction(action: string): WorkspaceTransferHistoryType {
  if (action === "sftp_download") return "download"
  if (action === "sftp_transfer") return "transfer"
  return "upload"
}

function parseDesktopTransferDetail(detail?: string): Record<string, unknown> {
  if (!detail) {
    return {}
  }
  try {
    const parsed = JSON.parse(detail)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return { error: detail }
  }
}

function detailString(detail: Record<string, unknown>, key: string): string | undefined {
  const value = detail[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

function detailNumber(detail: Record<string, unknown>, key: string): number {
  const value = detail[key]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function basename(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || value || "transfer"
}

function mapDesktopTransferStatus(status?: DesktopActivityLogStatus | string): WorkspaceTransferHistoryItem["status"] {
  return status === DesktopActivityLogStatus.DesktopActivityLogSuccess || status === "success"
    ? "completed"
    : "failed"
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function mapDesktopActivityLogItemToTransferHistoryItem(item: Awaited<ReturnType<typeof ActivityLogService.GetById>>): WorkspaceTransferHistoryItem {
  const detail = parseDesktopTransferDetail(item.detail)
  const sourcePath = detailString(detail, "source_path") ?? item.resource ?? ""
  const destPath = detailString(detail, "dest_path") ?? detailString(detail, "target_path") ?? ""
  const fileName = detailString(detail, "file_name") ?? basename(sourcePath || destPath || item.action)
  const fileSizeBytes = detailNumber(detail, "bytes_total") || detailNumber(detail, "file_size")
  const bytesTransferred = detailNumber(detail, "bytes_processed") || (item.status === DesktopActivityLogStatus.DesktopActivityLogSuccess ? fileSizeBytes : 0)
  const durationSeconds = item.durationMs ? Math.round(Number(item.durationMs) / 1000) : undefined
  const createdAt = item.createdAt || new Date().toISOString()
  const completedAt = mapDesktopTransferStatus(item.status) === "completed" ? createdAt : undefined

  return {
    id: item.id,
    serverId: item.serverId || detailString(detail, "source_server_id") || "",
    transferType: desktopTransferTypeFromAction(item.action || ""),
    sourcePath,
    destPath,
    fileName,
    fileSizeBytes,
    status: mapDesktopTransferStatus(item.status),
    progress: fileSizeBytes > 0 ? clampProgress((bytesTransferred / fileSizeBytes) * 100) : (completedAt ? 100 : 0),
    bytesTransferred,
    startedAt: createdAt,
    completedAt,
    durationSeconds,
    errorMessage: detailString(detail, "error"),
    createdAt,
    updatedAt: createdAt,
  }
}

function createDesktopTransferHistoryStatistics(items: WorkspaceTransferHistoryItem[]): WorkspaceTransferHistoryStatistics {
  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  let totalBytesUploaded = 0
  let totalBytesDownloaded = 0

  items.forEach((item) => {
    byType[item.transferType] = (byType[item.transferType] ?? 0) + 1
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1
    if (item.status !== "completed") {
      return
    }
    if (item.transferType === "upload") {
      totalBytesUploaded += item.fileSizeBytes
    }
    if (item.transferType === "download") {
      totalBytesDownloaded += item.fileSizeBytes
    }
  })

  return {
    totalTransfers: items.length,
    completedTransfers: byStatus.completed ?? 0,
    failedTransfers: byStatus.failed ?? 0,
    totalBytesUploaded,
    totalBytesDownloaded,
    byType,
    byStatus,
  }
}
