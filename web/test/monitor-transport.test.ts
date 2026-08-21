import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import {
  acquireMonitorTransport,
  destroyAllMonitorTransports,
} from "../src/components/terminal/monitor/hooks/monitor-transport"
import type { WorkspaceMonitorApi, WorkspaceMonitorMetrics } from "../src/lib/session/workspace"
import { useMonitorStore } from "../src/stores/monitor-store"

const metrics: WorkspaceMonitorMetrics = {
  systemInfo: {
    os: "linux",
    hostname: "edge-01",
    cpuModel: "test-cpu",
    arch: "amd64",
    loadAvg: "0.10 0.12 0.14",
    uptimeSeconds: 3600,
    cpuCores: 4,
  },
  cpu: { usagePercent: 18, coreCount: 4 },
  memory: {
    ramUsedBytes: 4_000,
    ramTotalBytes: 8_000,
    swapUsedBytes: 0,
    swapTotalBytes: 2_000,
  },
  network: { bytesRecvPerSec: 1_024, bytesSentPerSec: 512 },
  disks: [{ mountPoint: "/", usedBytes: 40_000, totalBytes: 100_000 }],
  diskTotalPercent: 40,
  sshLatencyMs: 12,
  timestamp: 1_787_230_000,
}

const waitForTimers = () => new Promise<void>((resolve) => setTimeout(resolve, 10))

afterEach(() => {
  destroyAllMonitorTransports()
})

describe("monitor transport", () => {
  it("shares one polling transport across terminal consumers and clears it after the final release", async () => {
    let collections = 0
    const monitorApi: WorkspaceMonitorApi = {
      async collectMetrics() {
        collections += 1
        return metrics
      },
    }

    const releaseFirst = acquireMonitorTransport({ serverId: "server-1", interval: 60, monitorApi })
    const releaseSecond = acquireMonitorTransport({ serverId: "server-1", interval: 60, monitorApi })
    await waitForTimers()

    assert.equal(collections, 1)
    assert.equal(useMonitorStore.getState().getMetrics("server-1")?.systemInfo.hostname, "edge-01")

    releaseFirst()
    await waitForTimers()
    assert.ok(useMonitorStore.getState().getMetrics("server-1"))

    releaseSecond()
    await waitForTimers()
    assert.equal(useMonitorStore.getState().getMetrics("server-1"), undefined)
  })
})
