import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMonitorViewData } from '../src/components/terminal/monitor/monitor-view-data'
import type { MonitorMetrics } from '../src/components/terminal/monitor/hooks/useMonitorWebSocket'

const sample = (): MonitorMetrics => ({
  systemInfo: { os: 'Debian', hostname: 'test', cpuModel: 'CPU', arch: 'x86_64', loadAvg: '0.1', uptimeSeconds: 61, cpuCores: 4 },
  cpu: { usagePercent: 10, coreCount: 2, iowaitPercent: 2, stealPercent: 1, coreUsagePercent: [5, 15] },
  memory: { ramUsedBytes: 1024, ramTotalBytes: 4096, ramCacheBytes: 1024, swapUsedBytes: 0, swapTotalBytes: 0 },
  network: {
    bytesRecvPerSec: 3072,
    bytesSentPerSec: 2048,
    defaultInterface: 'eth0',
    interfaces: [
      { name: 'eth0', bytesRecvPerSec: 1024, bytesSentPerSec: 2048 },
      { name: 'eth1', bytesRecvPerSec: 2048, bytesSentPerSec: 0 },
    ],
  },
  disks: [{ mountPoint: '/', usedBytes: 1024, totalBytes: 8192, device: '/dev/sda1', fsType: 'ext4', inodesUsed: 10, inodesTotal: 100 }],
  diskTotalPercent: 12.5, sshLatencyMs: 5, timestamp: 100,
})

describe('monitor presentation updates', () => {
  it('updates time series while reusing unchanged visible system, memory and disk data', () => {
    const project = createMonitorViewData()
    const first = sample()
    const a = project(first, [first], 'full')!
    const next = { ...sample(), timestamp: 102, cpu: { ...sample().cpu, usagePercent: 40, coreUsagePercent: [30, 50] } }
    next.systemInfo.uptimeSeconds = 63
    const b = project(next, [first, next], 'full')!
    assert.equal(b.systemInfo, a.systemInfo)
    assert.equal(b.memory, a.memory)
    assert.equal(b.disks, a.disks)
    assert.equal(b.currentCPU, 40)
    assert.equal(b.currentCPUWait, 3)
    assert.equal(b.cpuHistory.perCore, true)
    assert.equal(b.cpuHistory.times.length, 2)
    assert.deepEqual(b.cpuHistory.cores, [[5, 30], [15, 50]])
    assert.deepEqual(b.peakCore, { index: 1, usage: 50 })
    assert.deepEqual(b.currentNetwork, { download: 3, upload: 2 })
    assert.deepEqual(b.networkHistory.map(x => x.download), [3, 3])
    assert.equal(b.interfaceHistory.eth0[1].upload, 2)
    assert.equal(b.interfaceHistory.eth1[1].download, 2)
    assert.deepEqual(b.interfaces.map(x => x.name), ['eth0', 'eth1'])
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
    assert.equal(b.memory.ram.cachePercent, 25)
    assert.equal(b.memory.swap.percent, 0)
    assert.notEqual(b.disks, a.disks)
    assert.equal(b.disks[0].name, '/data')
    assert.equal(b.disks[0].inodePercent, 10)
    const reordered = { ...next, disks: [{ ...next.disks[0], mountPoint: '/other', usedBytes: 1, totalBytes: 10, inodesTotal: 0 }, ...next.disks] }
    const projected = project(reordered, [next], 'full')!
    assert.deepEqual(projected.disks.map(x => x.name), ['/other', '/data'])
    assert.equal(projected.disks[0].inodePercent, null)
  })

  it('aligns per-core history to samples that carry core data and falls back to total usage', () => {
    const project = createMonitorViewData()
    const first = { ...sample(), cpu: { ...sample().cpu, coreUsagePercent: [] } }
    const next = { ...sample(), timestamp: 102 }
    const view = project(next, [first, next], 'full')!
    assert.equal(view.cpuHistory.times.length, 1)
    assert.deepEqual(view.cpuHistory.cores, [[5], [15]])
    const totalsOnly = project(first, [first], 'full')!
    assert.deepEqual(totalsOnly.cpuHistory, { perCore: false, times: [totalsOnly.cpuHistory.times[0]], cores: [[10]] })
  })

  it('keeps the total network chart when there is no per-interface data', () => {
    const project = createMonitorViewData()
    const totalsOnly = sample()
    totalsOnly.network = { bytesRecvPerSec: 2048, bytesSentPerSec: 1024, defaultInterface: '', interfaces: [] }
    const view = project(totalsOnly, [totalsOnly], 'full')!
    assert.deepEqual(view.interfaces, [])
    assert.deepEqual(view.networkHistory.map(x => [x.download, x.upload]), [[2, 1]])
  })

  it('drops chart data in mini mode and restores the latest history on expansion', () => {
    const project = createMonitorViewData()
    const first = sample()
    const a = project(first, [first], 'mini')!
    assert.deepEqual(a.cpuHistory.cores, [])
    assert.deepEqual(a.networkHistory, [])
    assert.deepEqual(a.interfaceHistory, {})
    assert.equal(a.disks.length, 1)
    assert.equal(a.interfaces.length, 2)
    const b = project(first, [first], 'compact')!
    assert.equal(b.cpuHistory.cores[0].length, 1)
    assert.equal(b.interfaceHistory.eth0.length, 1)
    assert.equal(project(null, [], 'full'), null)
    assert.notEqual(project(first, [first], 'full')!.systemInfo, b.systemInfo)
  })
})
