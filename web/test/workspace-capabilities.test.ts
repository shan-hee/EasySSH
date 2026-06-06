import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { createWorkspaceCapabilitiesFromRuntime } from "../src/shell/runtime/runtime-workspace"
import { WORKSPACE_CAPABILITY_PRESETS } from "../src/shell/runtime/workspace-capability-presets"
import type { RuntimeInfo } from "../src/shell/runtime/types"

describe("workspace capability presets", () => {
  it("keeps the desktop preset limited to implemented desktop workspace features", () => {
    const capabilities = createWorkspaceCapabilitiesFromRuntime(null, WORKSPACE_CAPABILITY_PRESETS.desktop)

    assert.equal(capabilities.terminal, true)
    assert.equal(capabilities.ai, true)
    assert.equal(capabilities.activityLog, true)
    assert.equal(capabilities.fullscreen, true)
    assert.equal(capabilities.sftp, false)
    assert.equal(capabilities.transfers, false)
    assert.equal(capabilities.monitor, false)
    assert.equal(capabilities.docker, false)
    assert.equal(capabilities.crossSessionDrag, false)
  })

  it("lets runtime capabilities disable defaults", () => {
    const runtime = createRuntime({
      terminal: false,
      sftp: false,
      transfers: false,
      ai: false,
      monitoring: false,
      docker: false,
      activity_log: false,
    })

    const capabilities = createWorkspaceCapabilitiesFromRuntime(runtime, WORKSPACE_CAPABILITY_PRESETS.webTerminal)

    assert.equal(capabilities.terminal, false)
    assert.equal(capabilities.sftp, false)
    assert.equal(capabilities.transfers, false)
    assert.equal(capabilities.ai, false)
    assert.equal(capabilities.monitor, false)
    assert.equal(capabilities.docker, false)
    assert.equal(capabilities.activityLog, false)
    assert.equal(capabilities.fullscreen, true)
  })

  it("applies explicit overrides after runtime/default resolution", () => {
    const runtime = createRuntime({
      terminal: true,
      sftp: true,
      transfers: true,
    })

    const capabilities = createWorkspaceCapabilitiesFromRuntime(runtime, WORKSPACE_CAPABILITY_PRESETS.webSftp)

    assert.equal(capabilities.terminal, false)
    assert.equal(capabilities.sftp, true)
    assert.equal(capabilities.transfers, true)
    assert.equal(capabilities.crossSessionDrag, true)
  })
})

function createRuntime(capabilities: RuntimeInfo["capabilities"]): RuntimeInfo {
  return {
    profile: "web",
    principal: {
      kind: "user",
      role: "owner",
    },
    single_user: false,
    portable: false,
    managed: true,
    capabilities,
  }
}
