import { shallow } from 'zustand/vanilla/shallow'
import { formatBytes } from '@/lib/format-utils'
import type { MonitorMetrics } from './hooks/useMonitorWebSocket'
import type { CPUHistory, MonitorPanelDensity, NetworkData, SystemMetrics } from './types/metrics'

const toKB = (bytesPerSec: number) => Math.round(bytesPerSec / 1024)

// 每个面板保留自己的展示快照。只比较组件实际展示的值，不把原始包的对象引用
// 当作变化：例如 uptime 秒数变化但显示分钟不变，不应重绘系统信息。
export function createMonitorViewData() {
  let previous: SystemMetrics | null = null
  return (metrics: MonitorMetrics | null, history: MonitorMetrics[], density: MonitorPanelDensity): SystemMetrics | null => {
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
    const percentOf = (used: number, total: number) => total > 0 ? Math.round(used / total * 100) : 0
    const memoryValue = (used: number, total: number) => {
      const totalValue = formatBytes(total, 1)
      return { ...formatBytes(used, 1), total: totalValue.value, totalUnit: totalValue.unit, percent: percentOf(used, total) }
    }
    const { ramUsedBytes, ramTotalBytes, ramCacheBytes } = metrics.memory
    const memory = {
      ram: {
        ...memoryValue(ramUsedBytes, ramTotalBytes),
        cacheBytes: ramCacheBytes,
        cachePercent: percentOf(ramCacheBytes, ramTotalBytes),
      },
      swap: memoryValue(metrics.memory.swapUsedBytes, metrics.memory.swapTotalBytes),
    }
    const disks = metrics.disks.map(disk => ({
      name: disk.mountPoint,
      device: disk.device,
      fsType: disk.fsType,
      usedBytes: disk.usedBytes,
      totalBytes: disk.totalBytes,
      inodePercent: disk.inodesTotal > 0 ? percentOf(disk.inodesUsed, disk.inodesTotal) : null,
      ...memoryValue(disk.usedBytes, disk.totalBytes),
    }))
    const totalTimes: string[] = []
    const totalUsage: number[] = []
    const coreTimes: string[] = []
    const coreHistory: number[][] = []
    const networkHistory: NetworkData[] = []
    const interfaceHistory: Record<string, NetworkData[]> = {}
    if (density !== 'mini') {
      for (const sample of history) {
        const timestamp = sample.timestamp * 1000
        const time = new Date(timestamp).toTimeString().split(' ')[0]
        totalTimes.push(time)
        totalUsage.push(Math.round(sample.cpu.usagePercent))
        // 第一次采样没有基线，不带每核数据；每核历史用自己的时间轴，避免与时间错位。
        if (sample.cpu.coreUsagePercent.length > 0) {
          coreTimes.push(time)
          sample.cpu.coreUsagePercent.forEach((usage, core) => {
            (coreHistory[core] ??= []).push(Math.round(usage))
          })
        }
        networkHistory.push({ time, timestamp, download: toKB(sample.network.bytesRecvPerSec), upload: toKB(sample.network.bytesSentPerSec) })
        for (const iface of sample.network.interfaces) {
          (interfaceHistory[iface.name] ??= []).push({ time, timestamp, download: toKB(iface.bytesRecvPerSec), upload: toKB(iface.bytesSentPerSec) })
        }
      }
    }
    // 没有每核数据（桌面轮询）时用总使用率充当唯一一格。
    const cpuHistory: CPUHistory = coreHistory.length > 0
      ? { perCore: true, times: coreTimes, cores: coreHistory }
      : { perCore: false, times: totalTimes, cores: totalUsage.length > 0 ? [totalUsage] : [] }
    previous = {
      systemInfo: previous && shallow(previous.systemInfo, systemInfo) ? previous.systemInfo : systemInfo,
      memory: previous && shallow(previous.memory.ram, memory.ram) && shallow(previous.memory.swap, memory.swap) ? previous.memory : memory,
      disks: previous && previous.disks.length === disks.length && disks.every((disk, i) => shallow(previous!.disks[i], disk)) ? previous.disks : disks,
      cpuHistory,
      currentCPU: Math.round(metrics.cpu.usagePercent),
      currentCPUWait: Math.round(metrics.cpu.iowaitPercent + metrics.cpu.stealPercent),
      peakCore: metrics.cpu.coreUsagePercent.length > 1
        ? metrics.cpu.coreUsagePercent.reduce(
            (peak, usage, index) => (usage > peak.usage ? { index, usage: Math.round(usage) } : peak),
            { index: 0, usage: Math.round(metrics.cpu.coreUsagePercent[0]) },
          )
        : null,
      currentNetwork: { download: toKB(metrics.network.bytesRecvPerSec), upload: toKB(metrics.network.bytesSentPerSec) },
      networkHistory,
      interfaces: metrics.network.interfaces.map(iface => ({ name: iface.name, download: toKB(iface.bytesRecvPerSec), upload: toKB(iface.bytesSentPerSec) })),
      interfaceHistory,
    }
    return previous
  }
}
