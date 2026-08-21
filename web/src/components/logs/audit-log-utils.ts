import type { AuditLog } from "@/lib/log-types"

export function auditLogDetailPreview(log: AuditLog | null | undefined) {
  if (!log) return ""
  return log.details || log.error_msg || log.resource || log.user_agent || "-"
}
