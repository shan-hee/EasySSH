import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveAPIErrorMessage } from "../src/lib/api-error"

describe("resolveAPIErrorMessage", () => {
  it("prefers a structured response message", () => {
    assert.equal(
      resolveAPIErrorMessage({ error: "provider_error", message: "Invalid API key" }, "fallback"),
      "Invalid API key",
    )
  })

  it("reads the model probe error string", () => {
    assert.equal(
      resolveAPIErrorMessage({ available: false, models: [], error: "upstream TLS failure" }, "fallback"),
      "upstream TLS failure",
    )
  })

  it("reads nested OpenAI-compatible errors", () => {
    assert.equal(
      resolveAPIErrorMessage({ error: { type: "Unauthorized", message: "Invalid API key" } }, "fallback"),
      "Invalid API key",
    )
  })

  it("falls back when the response has no useful text", () => {
    assert.equal(resolveAPIErrorMessage({ error: {} }, "API 400 Bad Request"), "API 400 Bad Request")
  })
})
