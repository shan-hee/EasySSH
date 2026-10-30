import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { TFunction } from "i18next"

import { buildAgentMessageContext } from "../src/components/ai-agent/composer/context"
import type { ComposerAttachment } from "../src/components/ai-agent/composer/attachments"
import type { ComposerContextReference } from "../src/components/ai-agent/composer/context-references"

const t = ((key: string, options?: Record<string, unknown>) => (
  options?.count === undefined ? key : `${key}:${String(options.count)}`
)) as TFunction<"aiAssistant">

describe("AI explicit message context", () => {
  it("sends only references explicitly selected by the user", () => {
    const empty = buildAgentMessageContext({ attachments: [], selectedServers: [], references: [], t })
    assert.equal(empty, undefined)

    const references: ComposerContextReference[] = [
      {
        id: "cwd-1",
        kind: "working-directory",
        label: "当前工作目录",
        content: "/srv/easyssh",
      },
      {
        id: "output-1",
        kind: "terminal-output",
        label: "最近终端输出",
        content: "load average: 0.12 0.18 0.22",
      },
    ]

    const context = buildAgentMessageContext({ attachments: [], selectedServers: [], references, t })
    assert.match(context ?? "", /contextReferenceHeader/)
    assert.match(context ?? "", /## 当前工作目录\n\/srv\/easyssh/)
    assert.match(context ?? "", /## 最近终端输出\nload average/)
    assert.match(context ?? "", /contextReferenceRule/)
  })

  it("includes bounded text previews while describing images without duplicating their bytes", () => {
    const attachments: ComposerAttachment[] = [
      {
        id: "log-1",
        name: "app.log",
        size: 32,
        type: "text/plain",
        source: "text",
        content: "fatal: connection refused",
        truncated: true,
      },
      {
        id: "image-1",
        name: "graph.png",
        size: 128,
        type: "image/png",
        source: "image",
        file: new File(["png"], "graph.png", { type: "image/png" }),
        previewUrl: "blob:preview",
        truncated: false,
      },
    ]

    const context = buildAgentMessageContext({ attachments, selectedServers: [], t })
    assert.match(context ?? "", /fatal: connection refused/)
    assert.match(context ?? "", /attachmentContextTruncated:12000/)
    assert.match(context ?? "", /attachmentContextImage/)
    assert.doesNotMatch(context ?? "", /blob:preview/)
  })
})
