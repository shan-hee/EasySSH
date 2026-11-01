import {
  DesktopActivityLogStatus,
  type DesktopActivityLogItem,
} from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"
import type {
  AuditLog,
  WorkspaceActivityLogItem,
  WorkspaceActivityLogStatus,
} from "@easyssh/app/desktop"
import { DESKTOP_LOCAL_USERNAME } from "./desktop-local-identity"

export const desktopLogUsername = DESKTOP_LOCAL_USERNAME
export const desktopLogSource = "desktop"

export function mapWorkspaceActivityLogStatusToDesktop(status: WorkspaceActivityLogStatus): DesktopActivityLogStatus {
  if (status === "failure") return DesktopActivityLogStatus.DesktopActivityLogFailure
  if (status === "warning") return DesktopActivityLogStatus.DesktopActivityLogWarning
  return DesktopActivityLogStatus.DesktopActivityLogSuccess
}

export function mapDesktopActivityLogStatus(status?: DesktopActivityLogStatus | string): WorkspaceActivityLogStatus {
  if (status === DesktopActivityLogStatus.DesktopActivityLogFailure || status === "failure") return "failure"
  if (status === DesktopActivityLogStatus.DesktopActivityLogWarning || status === "warning") return "warning"
  if (status === "pending" || status === "running" || status === "partial" || status === "canceled" || status === "timeout" || status === "unknown" || status === "success") return status
  return "unknown"
}

export function mapDesktopActivityLogItem(item: DesktopActivityLogItem): WorkspaceActivityLogItem {
  return {
    id: item.id,
    action: item.action,
    resource: item.resource,
    status: mapDesktopActivityLogStatus(item.status),
    serverId: item.serverId,
    durationMs: item.durationMs,
    detail: item.detail,
    createdAt: item.createdAt,
  }
}

export function desktopAuditLogTypeFromAction(action: string): AuditLog["type"] {
  if (action.startsWith("ssh_")) return "connection"
  if (action.startsWith("sftp_")) return "transfer"
  if (action.startsWith("script_")) return "execution"
  return "execution"
}

function desktopActivityProgress(item: DesktopActivityLogItem) {
  if (item.bytes_total > 0) return Math.min(100, Math.round((item.bytes_processed / item.bytes_total) * 100))
  if (item.total_count > 0) return Math.min(100, Math.round(((item.success_count + item.failure_count) / item.total_count) * 100))
  return 0
}

export function mapDesktopActivityLogItemToAuditLog(item: DesktopActivityLogItem): AuditLog {
  const action = item.action || ""
  return {
    id: item.id,
    username: desktopLogUsername,
    source_table: item.source_table, source_id: item.source_id, resources: item.resources,
    server_id: item.serverId || undefined,
    type: desktopAuditLogTypeFromAction(action),
    action,
    category: "activity",
    resource: item.resource || "",
    source: desktopLogSource,
    status: mapDesktopActivityLogStatus(item.status),
    ip: "",
    user_agent: "EasySSH",
    details: item.detail || "",
    error_msg: item.error_message || undefined,
    duration: item.durationMs || 0,
    created_at: item.createdAt,
    server_name: item.server_name || undefined,
    attempt: item.attempt,
    progress: desktopActivityProgress(item),
    total_count: item.total_count,
    success_count: item.success_count,
    failure_count: item.failure_count,
    bytes_total: item.bytes_total,
    bytes_processed: item.bytes_processed,
  }
}

export function normalizeDesktopActivityLogStatusFilter(status?: string | string[]) {
  if (Array.isArray(status)) {
    return status.length === 1 ? normalizeDesktopActivityLogStatusFilter(status[0]) : undefined
  }
  if (status === "success" || status === "failure" || status === "warning") {
    return mapWorkspaceActivityLogStatusToDesktop(status)
  }
  return undefined
}
