import assert from "node:assert/strict"
import test from "node:test"

import type { TaskRun, TaskRunListResponse } from "../src/components/task-center/task-center-contracts"
import { patchTaskRunList, taskRealtimePatchFromEvent } from "../src/components/task-center/task-center-realtime"

function run(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run-1", user_id: "user-1", task_type: "command", title: "Check", trigger_type: "manual",
    runner: "server", status: "running", progress: 10, total_count: 1, success_count: 0, failure_count: 0,
    bytes_total: 0, bytes_processed: 0, cancelable: true, retryable: true, attempt: 1, max_attempts: 1,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...overrides,
  }
}

test("progress events patch cached runs without reporting a status transition", () => {
  const current: TaskRunListResponse = { runs: [run()], total: 1, page: 1, page_size: 20, total_pages: 1 }
  const patch = taskRealtimePatchFromEvent({
    data: { task_id: "run-1", status: "running", progress: 42, stage: "executing" },
    created_at: "2026-01-01T00:00:01Z",
  })
  assert.ok(patch)
  const result = patchTaskRunList(current, patch)
  assert.equal(result.found, true)
  assert.equal(result.statusChanged, false)
  assert.equal(result.data.runs[0].progress, 42)
  assert.equal(result.data.runs[0].stage, "executing")
})

test("status transitions request an authoritative refresh", () => {
  const current: TaskRunListResponse = { runs: [run()], total: 1, page: 1, page_size: 20, total_pages: 1 }
  const result = patchTaskRunList(current, {
    taskId: "run-1", status: "succeeded", progress: 100, updatedAt: "2026-01-01T00:00:02Z",
  })
  assert.equal(result.statusChanged, true)
  assert.equal(result.data.runs[0].status, "succeeded")
})
