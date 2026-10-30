import type { OperationRecord } from "@/lib/api/operation-records"

export function operationRecordDetailPreview(record: OperationRecord | null | undefined) {
  if (!record) return ""
  return record.detail_json || record.error_message || record.resource || record.user_agent || "-"
}
