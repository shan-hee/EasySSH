import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  RefreshTokenError,
  isTerminalRefreshTokenError,
} from "../src/lib/session-refresh"

describe("isTerminalRefreshTokenError", () => {
  it("treats a missing refresh token as an unauthenticated session", () => {
    const error = new RefreshTokenError(400, {
      error: "invalid_grant",
      error_description: "Missing refresh token",
    })

    assert.equal(isTerminalRefreshTokenError(error), true)
  })

  it("treats unauthorized refresh responses as terminal", () => {
    assert.equal(
      isTerminalRefreshTokenError(new RefreshTokenError(401, { error: "invalid_token" })),
      true,
    )
  })

  it("keeps protocol and service failures visible", () => {
    assert.equal(
      isTerminalRefreshTokenError(new RefreshTokenError(400, { error: "invalid_request" })),
      false,
    )
    assert.equal(
      isTerminalRefreshTokenError(new RefreshTokenError(503, { error: "service_unavailable" })),
      false,
    )
  })
})
