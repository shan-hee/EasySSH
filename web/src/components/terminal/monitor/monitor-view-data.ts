import { shallow } from 'zustand/vanilla/shallow'
import { formatBytes } from '@/lib/format-utils'
import type { MonitorMetrics } from './hooks/useMonitorWebSocket'
import type { CPUData, NetworkData, MonitorPanelDensity, SystemMetrics } from './types/metrics'

type MonitorViewData = SystemMetrics & { diskTotalPercent: number }

// 每个面板保留自己的展示快照。只比较组件实际展示的值，不把原始包的对象引用
// 当作变化：例如 uptime 秒数变化但显示分钟不变，不应重绘系统信息。
export function createMonitorViewData() {
  let previous: MonitorViewData | null = null
  return (metrics: MonitorMetrics | null, history: MonitorMetrics[], density: MonitorPanelDensity): MonitorViewData | null => {
    if (!metrics) return (previous = null)
    const seconds = metrics.systemInfo.uptimeSeconds
    const systemInfo = {
      os: metrics.systemInfo.os,
      hostname: metrics.systemInfo.hostname,
      cpu: metrics.systemInfo.cpuModel,
      arch: metrics.systemInfo.arch,
      load: metrics.systemInfo.loadAvg,
      uptime: `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`,
    }
    const memoryValue = (used: number, total: number) => {
      const totalValue = formatBytes(total)
      return { ...formatBytes(used), total: totalValue.value, totalUnit: totalValue.unit, percent: total > 0 ? Math.round(used / total * 100) : 0 }
    }
    const memory = {
      ram: memoryValue(metrics.memory.ramUsedBytes, metrics.memory.ramTotalBytes),
      swap: memoryValue(metrics.memory.swapUsedBytes, metrics.memory.swapTotalBytes),
    }
    const disks = density === 'mini' ? [] : metrics.disks.map(disk => ({
      name: disk.mountPoint,
      usedBytes: disk.usedBytes,
      totalBytes: disk.totalBytes,
      ...memoryValue(disk.usedBytes, disk.totalBytes),
    }))
    const cpuHistory: CPUData[] = []
    const networkHistory: NetworkData[] = []
    if (density !== 'mini') {
      for (const sample of history) {
        const timestamp = sample.timestamp * 1000
        const time = new Date(timestamp).toTimeString().split(' ')[0]
        cpuHistory.push({ time, timestamp, usage: Math.round(sample.cpu.usagePercent) })
        networkHistory.push({ time, timestamp, download: Math.round(sample.network.bytesRecvPerSec / 1024), upload: Math.round(sample.network.bytesSentPerSec / 1024) })
      }
    }
    previous = {
      systemInfo: previous && shallow(previous.systemInfo, systemInfo) ? previous.systemInfo : systemInfo,
      memory: previous && shallow(previous.memory.ram, memory.ram) && shallow(previous.memory.swap, memory.swap) ? previous.memory : memory,
      disks: previous && previous.disks.length === disks.length && disks.every((disk, i) => shallow(previous!.disks[i], disk)) ? previous.disks : disks,
      cpuHistory,
      networkHistory,
      currentCPU: Math.round(metrics.cpu.usagePercent),
      currentNetwork: { download: Math.round(metrics.network.bytesRecvPerSec / 1024), upload: Math.round(metrics.network.bytesSentPerSec / 1024) },
      diskTotalPercent: Math.round(metrics.diskTotalPercent),
    }
    return previous
  }
}
