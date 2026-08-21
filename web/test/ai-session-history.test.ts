import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  createAISessionListItem,
  getDefaultAISessionTitle,
  syncAISessionHistoryItems,
} from "../src/hooks/use-ai-session-history"
import type { CreateSessionResponse, SessionView } from "../src/lib/ai-agent-types"

function createSession(overrides: Partial<SessionView> = {}): SessionView {
  return {
    id: "session-1",
    model: "gpt-test",
    permission_mode: "balanced",
    scope: { kind: "terminal", terminal_session_id: "terminal-1", server_name: "edge-01" },
    status: "idle",
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:01:00Z",
    messages: [],
    tasks: [],
    ui_messages: [],
    available_tools: [],
    default_transport: "ai_sdk_ui",
    ...overrides,
  }
}

describe("AI session history helpers", () => {
  it("uses the first user command as a stable, bounded default title", () => {
    const session = createSession({
      messages: [
        { id: "system", role: "system", content: "system", created_at: "2026-08-20T00:00:00Z" },
        {
          id: "user",
          role: "user",
          content: "检查生产服务器的 CPU、内存、磁盘和网络状态，并给出风险摘要、根因分析、处理建议与验证命令",
          created_at: "2026-08-20T00:00:01Z",
        },
      ],
    })

    const title = getDefaultAISessionTitle(session, "新会话")
    assert.equal(Array.from(title.replace(/…$/, "")).length, 40)
    assert.ok(title.endsWith("…"))
  })

  it("preserves scope and counters when prepending a newly created session", () => {
    const session = createSession({
      messages: [{ id: "user", role: "user", content: "uptime", created_at: "2026-08-20T00:00:01Z" }],
      tasks: [{
        id: "task-1",
        tool_call_id: "call-1",
        tool_name: "execute_command",
        status: "succeeded",
        dangerous: false,
        requires_confirmation: false,
        created_at: "2026-08-20T00:00:02Z",
        updated_at: "2026-08-20T00:00:03Z",
      }],
    })
    const response: CreateSessionResponse = {
      session_id: session.id,
      session,
      default_transport: "ai_sdk_ui",
    }

    const item = createAISessionListItem(response, "新会话")
    assert.deepEqual(item.scope, session.scope)
    assert.equal(item.message_count, 1)
    assert.equal(item.task_count, 1)
    assert.equal(item.custom_title, false)
  })

  it("updates a closed history list immediately after the first user message", () => {
    const emptySession = createSession()
    const initialItem = createAISessionListItem({
      session_id: emptySession.id,
      session: emptySession,
      default_transport: "ai_sdk_ui",
    }, "新会话")
    const runningSession = createSession({
      status: "running",
      messages: [{
        id: "client-user-message",
        role: "user",
        content: "检查服务器负载",
        created_at: "2026-08-20T00:01:01Z",
      }],
    })

    const items = syncAISessionHistoryItems(
      [initialItem],
      runningSession,
      "新会话",
      "",
    )

    assert.equal(items[0]?.title, "检查服务器负载")
    assert.equal(items[0]?.message_count, 1)
    assert.equal(items[0]?.status, "running")
  })
})
