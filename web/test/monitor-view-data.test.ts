import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMonitorViewData } from '../src/components/terminal/monitor/monitor-view-data'
import type { MonitorMetrics } from '../src/components/terminal/monitor/hooks/useMonitorWebSocket'

const sample = (): MonitorMetrics => ({
  systemInfo: { os: 'Debian', hostname: 'test', cpuModel: 'CPU', arch: 'x86_64', loadAvg: '0.1', uptimeSeconds: 61, cpuCores: 4 },
  cpu: { usagePercent: 10, coreCount: 4 },
  memory: { ramUsedBytes: 1024, ramTotalBytes: 4096, swapUsedBytes: 0, swapTotalBytes: 0 },
  network: { bytesRecvPerSec: 1024, bytesSentPerSec: 2048 },
  disks: [{ mountPoint: '/', usedBytes: 1024, totalBytes: 8192 }],
  diskTotalPercent: 12.5, sshLatencyMs: 5, timestamp: 100,
})

describe('monitor presentation updates', () => {
  it('updates time series while reusing unchanged visible system, memory and disk data', () => {
    const project = createMonitorViewData()
    const first = sample()
    const a = project(first, [first], 'full')!
    const next = { ...sample(), timestamp: 102, cpu: { usagePercent: 40, coreCount: 4 } }
    next.systemInfo.uptimeSeconds = 63
    const b = project(next, [first, next], 'full')!
    assert.equal(b.systemInfo, a.systemInfo)
    assert.equal(b.memory, a.memory)
    assert.equal(b.disks, a.disks)
    assert.equal(b.currentCPU, 40)
    assert.deepEqual(b.cpuHistory.map(x => x.timestamp), [100000, 102000])
    assert.equal(b.networkHistory[1].download, 1)
    assert.equal(b.networkHistory[1].upload, 2)
  })

  it('invalidates all visible changes including minute boundaries and disk identity/order', () => {
    const project = createMonitorViewData()
    const first = sample()
    const a = project(first, [first], 'full')!
    const next = sample()
    next.systemInfo.uptimeSeconds = 120
    next.systemInfo.loadAvg = '0.2'
    next.memory.ramUsedBytes = 2048
    next.disks[0].mountPoint = '/data'
    const b = project(next, [next], 'full')!
    assert.notEqual(b.systemInfo, a.systemInfo)
    assert.equal(b.systemInfo.uptime, '0d 0h 2m')
    assert.equal(b.systemInfo.load, '0.2')
    assert.notEqual(b.memory, a.memory)
    assert.equal(b.memory.ram.percent, 50)
    assert.equal(b.memory.swap.percent, 0)
    assert.notEqual(b.disks, a.disks)
    assert.equal(b.disks[0].name, '/data')
    const reordered = { ...next, disks: [{ mountPoint: '/other', usedBytes: 1, totalBytes: 10 }, ...next.disks] }
    assert.deepEqual(project(reordered, [next], 'full')!.disks.map(x => x.name), ['/other', '/data'])
  })

  it('drops chart data in mini mode and restores the latest history on expansion', () => {
    const project = createMonitorViewData()
    const first = sample()
    const a = project(first, [first], 'mini')!
    assert.deepEqual(a.cpuHistory, [])
    assert.deepEqual(a.networkHistory, [])
    assert.deepEqual(a.disks, [])
    const b = project(first, [first], 'compact')!
    assert.equal(b.cpuHistory.length, 1)
    assert.equal(b.disks.length, 1)
    assert.equal(project(null, [], 'full'), null)
    assert.notEqual(project(first, [first], 'full')!.systemInfo, b.systemInfo)
  })
})
