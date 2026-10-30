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
    duration: item.durationMs || 0,
    created_at: item.createdAt,
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
