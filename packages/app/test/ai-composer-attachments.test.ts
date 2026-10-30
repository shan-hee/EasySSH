import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  ATTACHMENT_IMAGE_SIZE_LIMIT,
  ATTACHMENT_TEXT_PREVIEW_LIMIT,
  createComposerAttachment,
  releaseComposerAttachment,
  toAgentImageAttachments,
} from "../src/components/ai-agent/composer/attachments"

describe("AI composer attachments", () => {
  it("keeps image bytes out of state until the send conversion", async () => {
    const file = new File([new Uint8Array([0, 1, 2, 253, 254, 255])], "capture.png", {
      type: "image/png",
      lastModified: 1,
    })

    const attachment = await createComposerAttachment(file)
    assert.equal(attachment.source, "image")
    assert.equal(attachment.file, file)
    assert.ok(attachment.previewUrl?.startsWith("blob:"))
    assert.equal("data" in attachment, false)

    const payload = await toAgentImageAttachments([attachment])
    assert.equal(payload.length, 1)
    assert.equal(payload[0]?.data, "AAEC/f7/")
    assert.equal(payload[0]?.media_type, "image/png")

    const originalRevokeObjectURL = URL.revokeObjectURL
    let releasedURL = ""
    URL.revokeObjectURL = (value) => {
      releasedURL = value
      originalRevokeObjectURL(value)
    }
    try {
      releaseComposerAttachment(attachment)
      assert.equal(releasedURL, attachment.previewUrl)
    } finally {
      URL.revokeObjectURL = originalRevokeObjectURL
    }
  })

  it("sanitizes and truncates text previews without retaining the whole file", async () => {
    const content = `${"a".repeat(ATTACHMENT_TEXT_PREVIEW_LIMIT)}\0trailing`
    const attachment = await createComposerAttachment(new File([content], "server.log", {
      type: "text/plain",
      lastModified: 2,
    }))

    assert.equal(attachment.source, "text")
    assert.equal(attachment.content?.length, ATTACHMENT_TEXT_PREVIEW_LIMIT)
    assert.equal(attachment.content?.includes("\0"), false)
    assert.equal(attachment.truncated, true)
    assert.equal(attachment.file, undefined)
  })

  it("rejects unsupported and oversized images", async () => {
    await assert.rejects(
      createComposerAttachment(new File(["svg"], "vector.svg", { type: "image/svg+xml" })),
      /Unsupported image type/,
    )
    await assert.rejects(
      createComposerAttachment(new File(
        [new Uint8Array(ATTACHMENT_IMAGE_SIZE_LIMIT + 1)],
        "large.png",
        { type: "image/png" },
      )),
      /exceeds/,
    )
  })
})
