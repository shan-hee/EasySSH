import {
  ActivityLogService,
  DesktopActivityLogStatus,
  type DesktopActivityLogItem,
  type DesktopActivityLogListParams,
} from "../../bindings/github.com/easyssh/easyssh-desktop"
import type {
  AuditLog,
  AuditLogCleanupResponse,
  AuditLogListParams,
  AuditLogListResponse,
  AuditLogStatisticsResponse,
  AuditLogStatus,
} from "@easyssh/ssh-workspace/desktop"

const desktopUserId = "desktop-local-owner"
const desktopUsername = "desktop"
const desktopSource = "desktop"
const maxDesktopLogPages = 100

function desktopTypeFromAction(action: string): AuditLog["type"] {
  if (action.startsWith("ssh_")) return "connection"
  if (action.startsWith("sftp_")) return "transfer"
  if (action.startsWith("script_")) return "execution"
  return "audit"
}

function normalizeDesktopStatus(status?: DesktopActivityLogStatus | string): AuditLogStatus {
  if (status === DesktopActivityLogStatus.DesktopActivityLogFailure || status === "failure") return "failure"
  if (status === DesktopActivityLogStatus.DesktopActivityLogWarning || status === "warning") return "warning"
  return "success"
}

function mapDesktopLog(item: DesktopActivityLogItem): AuditLog {
  const action = item.action || ""
  return {
    id: item.id,
    user_id: desktopUserId,
    username: desktopUsername,
    server_id: item.serverId || undefined,
    type: desktopTypeFromAction(action),
    action,
    category: "activity",
    resource: item.resource || "",
    source: desktopSource,
    status: normalizeDesktopStatus(item.status),
    ip: "",
    user_agent: "EasySSH",
    details: item.detail || "",
    duration: item.durationMs || 0,
    created_at: item.createdAt,
  }
}

function matchKeyword(log: AuditLog, keyword?: string) {
  const value = keyword?.trim().toLowerCase()
  if (!value) return true
  return [
    log.username,
    log.action,
    log.resource,
    log.source,
    log.ip,
    log.details,
    log.error_msg,
    log.server_id,
  ].some((item) => item?.toLowerCase().includes(value))
}

function includesFilter<T extends string>(filter: T | T[] | undefined, value: T | undefined) {
  if (!filter) return true
  if (!value) return false
  return Array.isArray(filter) ? filter.includes(value) : filter === value
}

function filterLogs(logs: AuditLog[], params?: AuditLogListParams) {
  return logs.filter((log) => {
    if (!includesFilter(params?.type, log.type)) return false
    if (!includesFilter(params?.category, log.category)) return false
    if (!includesFilter(params?.status, log.status)) return false
    if (params?.source && !log.source?.toLowerCase().includes(params.source.toLowerCase())) return false
    if (params?.ip && !log.ip?.toLowerCase().includes(params.ip.toLowerCase())) return false
    return matchKeyword(log, params?.keyword || params?.q)
  })
}

function compareStrings(left?: string, right?: string) {
  return String(left || "").localeCompare(String(right || ""))
}

function sortLogs(logs: AuditLog[], params?: AuditLogListParams) {
  const sortBy = params?.sort_by || "created_at"
  const direction = params?.sort_order === "asc" ? 1 : -1
  return [...logs].sort((left, right) => {
    let result = 0
    switch (sortBy) {
      case "action":
        result = compareStrings(left.action, right.action)
        break
      case "username":
        result = compareStrings(left.username, right.username)
        break
      case "type":
        result = compareStrings(left.type, right.type)
        break
      case "category":
        result = compareStrings(left.category, right.category)
        break
      case "status":
        result = compareStrings(left.status, right.status)
        break
      case "resource":
        result = compareStrings(left.resource, right.resource)
        break
      case "source":
        result = compareStrings(left.source, right.source)
        break
      case "duration_ms":
      case "duration":
        result = (left.duration || 0) - (right.duration || 0)
        break
      case "created_at":
      default:
        result = new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
        break
    }
    return result * direction
  })
}

function normalizeDesktopStatusFilter(status?: string | string[]) {
  if (Array.isArray(status)) {
    return status.length === 1 ? normalizeDesktopStatusFilter(status[0]) : undefined
  }
  return (
    status === "success" ||
    status === "failure" ||
    status === "warning"
      ? status as DesktopActivityLogStatus
      : undefined
  )
}

async function fetchDesktopLogs(params?: AuditLogListParams) {
  const request: DesktopActivityLogListParams = {
    page: 1,
    limit: 100,
    action: params?.action,
    status: normalizeDesktopStatusFilter(params?.status),
    startDate: params?.start_date,
    endDate: params?.end_date,
  }

  const allItems: DesktopActivityLogItem[] = []
  let currentPage = 1
  let totalPages = 1

  do {
    const result = await ActivityLogService.List({ ...request, page: currentPage })
    allItems.push(...(result.items || []))
    totalPages = Math.max(1, result.totalPages || 1)
    currentPage += 1
  } while (currentPage <= totalPages && currentPage <= maxDesktopLogPages)

  return allItems.map(mapDesktopLog)
}

function retentionDaysToBefore(retentionDays: number) {
  const before = new Date()
  before.setUTCDate(before.getUTCDate() - retentionDays)
  return before.toISOString()
}

export function createDesktopLogsApi() {
  return {
    async list(params?: AuditLogListParams): Promise<AuditLogListResponse> {
      const page = Math.max(1, params?.page || 1)
      const pageSize = Math.max(1, Math.min(params?.page_size || 20, 100))
      const logs = sortLogs(filterLogs(await fetchDesktopLogs(params), params), params)
      const total = logs.length
      const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1
      const start = (page - 1) * pageSize

      return {
        logs: logs.slice(start, start + pageSize),
        total,
        page,
        page_size: pageSize,
        total_pages: totalPages,
      }
    },

    async getStatistics(params?: {
      category?: "activity" | "audit"
      start_date?: string
      end_date?: string
    }): Promise<AuditLogStatisticsResponse> {
      const logs = filterLogs(await fetchDesktopLogs(params), {
        category: params?.category,
      })
      const actionStats = logs.reduce<Record<string, number>>((acc, log) => {
        acc[log.action] = (acc[log.action] || 0) + 1
        return acc
      }, {})
      const recentFailures = logs
        .filter((log) => log.status !== "success")
        .slice(0, 10)

      return {
        total_logs: logs.length,
        success_count: logs.filter((log) => log.status === "success").length,
        failure_count: logs.filter((log) => log.status !== "success").length,
        action_stats: actionStats,
        recent_failures: recentFailures,
        top_users: logs.length
          ? [{ user_id: desktopUserId, username: desktopUsername, count: logs.length }]
          : [],
      }
    },

    async cleanup(retentionDays: number): Promise<AuditLogCleanupResponse> {
      const deletedCount = await ActivityLogService.Clear(retentionDaysToBefore(retentionDays))

      return {
        deleted_count: deletedCount,
        retention_days: retentionDays,
      }
    },
  }
}
