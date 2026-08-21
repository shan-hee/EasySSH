import assert from "node:assert/strict"
import test from "node:test"

import type { OperationRecord } from "../src/lib/api/operation-records"
import { operationRecordDetailPreview } from "../src/pages/dashboard/operation-record-utils"

function record(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: "record-1", user_id: "user-1", username: "user", type: "audit", category: "audit",
    action: "update", status: "success", server_name: "", title: "Update", resource: "/settings",
    source: "api", ip: "127.0.0.1", duration_ms: 1, progress: 0, total_count: 0, success_count: 0,
    failure_count: 0, bytes_total: 0, bytes_processed: 0, speed_bps: 0, source_table: "audit_events",
    source_id: "source-1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

test("detail preview and copy value share the same fallback order", () => {
  assert.equal(operationRecordDetailPreview(record({ detail_json: "details", error_message: "error" })), "details")
  assert.equal(operationRecordDetailPreview(record({ error_message: "error" })), "error")
  assert.equal(operationRecordDetailPreview(record({ resource: "/srv/app", user_agent: "agent" })), "/srv/app")
  assert.equal(operationRecordDetailPreview(record({ resource: "", user_agent: "agent" })), "agent")
  assert.equal(operationRecordDetailPreview(record({ resource: "", user_agent: "" })), "-")
})
