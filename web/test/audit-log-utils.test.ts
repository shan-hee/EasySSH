import assert from "node:assert/strict"
import test from "node:test"

import { auditLogDetailPreview } from "../src/components/logs/audit-log-utils"
import type { AuditLog } from "../src/lib/log-types"

function log(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: "log-1",
    user_id: "user-1",
    username: "admin",
    type: "audit",
    action: "update",
    category: "audit",
    resource: "/settings",
    source: "api",
    status: "success",
    ip: "127.0.0.1",
    user_agent: "agent",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

test("activity log preview and copy value share one fallback order", () => {
  assert.equal(auditLogDetailPreview(log({ details: "details", error_msg: "error" })), "details")
  assert.equal(auditLogDetailPreview(log({ details: "", error_msg: "error" })), "error")
  assert.equal(auditLogDetailPreview(log({ details: "", error_msg: "", resource: "/srv/app" })), "/srv/app")
  assert.equal(auditLogDetailPreview(log({ details: "", error_msg: "", resource: "", user_agent: "agent" })), "agent")
  assert.equal(auditLogDetailPreview(log({ details: "", error_msg: "", resource: "", user_agent: "" })), "-")
})
