import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { UIMessage } from "@ai-sdk/react"

import { resolveOutgoingUserMessageId } from "../src/lib/ai-agent/message-transport"

describe("AI message transport", () => {
  it("uses the generated UI user ID for a newly submitted message", () => {
    const latest: UIMessage = {
      id: "client-user-message",
      role: "user",
      parts: [{ type: "text", text: "uptime" }],
    }

    assert.equal(resolveOutgoingUserMessageId(latest, undefined), "client-user-message")
  })

  it("keeps the requested ID when the latest message is not a user message", () => {
    const latest: UIMessage = {
      id: "assistant-message",
      role: "assistant",
      parts: [{ type: "text", text: "done" }],
    }

    assert.equal(resolveOutgoingUserMessageId(latest, "user-to-regenerate"), "user-to-regenerate")
  })
})
