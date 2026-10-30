import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  applyTaskOutputDelta,
  applyTextDelta,
  buildUIMessages,
  loadAISessionHistory,
  mergeTaskView,
  upsertTaskUIPart,
  type AIHistoryReader,
} from "../src/lib/ai-agent/history"
import type { AIHistoryPage, MessageView, SessionOverviewResponse, TaskView } from "../src/lib/ai-agent-types"

const user: MessageView = { id: "user-1", role: "user", content: "检查磁盘", created_at: "2026-10-30T00:00:00Z" }
const assistant: MessageView = { id: "assistant-1", role: "assistant", content: "<think>先看挂载点</think>磁盘正常", created_at: "2026-10-30T00:00:02Z" }
const task: TaskView = {
  id: "task-1",
  assistant_message_id: "assistant-1",
  tool_call_id: "call-1",
  tool_name: "execute_command",
  status: "succeeded",
  dangerous: false,
  requires_confirmation: false,
  arguments: { command: "df -h" },
  result: "ok",
  created_at: "2026-10-30T00:00:01Z",
  updated_at: "2026-10-30T00:00:01Z",
}

describe("AI history timeline", () => {
  it("orders messages and tools into one assistant turn", () => {
    const messages = buildUIMessages([user, assistant], [task])

    assert.deepEqual(messages.map((message) => message.id), ["user-1", "assistant-1"])
    const parts = messages[1]!.parts.map((part) => part.type)
    assert.deepEqual(parts, ["step-start", "dynamic-tool", "reasoning", "text"])
    const tool = messages[1]!.parts[1] as { state?: string; output?: unknown }
    assert.equal(tool.state, "output-available")
    assert.equal(tool.output, "ok")
  })

  it("reads large history items through content references", async () => {
    const encoded = Buffer.from(JSON.stringify(assistant)).toString("base64")
    const reader: AIHistoryReader = {
      async page(_sessionId, kind) {
        if (kind === "tasks") return { session_id: "s", kind, updated_at: "", items: [], total: 0, next_after_id: "", has_more: false }
        // 前端消息类型比契约宽松，测试数据按原样作为历史条目。
        return ({
          session_id: "s",
          kind,
          updated_at: "",
          total: 2,
          next_after_id: "",
          has_more: false,
          items: [
            { id: "user-1", bytes: 10, hash: "a".repeat(64), data: user },
            { id: "assistant-1", bytes: 10, hash: "b".repeat(64), content: { id: "content-1", size: Buffer.byteLength(JSON.stringify(assistant)), sha256: "c".repeat(64), media_type: "application/json" } },
          ],
        }) as unknown as AIHistoryPage
      },
      async readChunk(reference, offset) {
        return { id: reference.id, sha256: reference.sha256, offset, next_offset: reference.size, size: reference.size, data: encoded }
      },
    }
    const overview: SessionOverviewResponse = {
      session_id: "s",
      default_transport: "ai_sdk_ui",
      session: { id: "s", model: "m", permission_mode: "balanced", status: "idle", created_at: "", updated_at: "", available_tools: [], default_transport: "ai_sdk_ui" },
    }

    const response = await loadAISessionHistory(overview, reader)

    assert.deepEqual(response.session.messages.map((message) => message.id), ["user-1", "assistant-1"])
    assert.equal(response.session.ui_messages.length, 2)
  })
})

describe("AI live updates", () => {
  it("appends text deltas and rejects gaps", () => {
    const delta = { message_id: "live", kind: "text" as const, offset: 0, next_offset: 3, text: "abc", created_at: "2026-10-30T00:00:00Z" }
    const first = applyTextDelta([], delta)!
    const second = applyTextDelta(first, { ...delta, offset: 3, next_offset: 6, text: "def" })!

    assert.equal((second[0]!.parts[0] as { text: string }).text, "abcdef")
    assert.equal(applyTextDelta(second, { ...delta, offset: 9, next_offset: 10, text: "x" }), null)
  })

  it("keeps received command output when task metadata arrives without it", () => {
    const tasks = applyTaskOutputDelta([task], { session_id: "s", task_id: "task-1", offset: 0, next_offset: 2, text: "ok", reset: true })!
    const merged = mergeTaskView(tasks, { ...task, status: "running" })

    assert.equal(merged[0]?.command_output, "ok")
    assert.equal(merged[0]?.status, "running")
  })

  it("replaces the tool part of an existing call", () => {
    const messages = buildUIMessages([user], [{ ...task, status: "running" }])
    const updated = upsertTaskUIPart(messages, task)
    const tools = updated.flatMap((message) => message.parts).filter((part) => part.type === "dynamic-tool")

    assert.equal(tools.length, 1)
    assert.equal((tools[0] as { state?: string }).state, "output-available")
  })
})
