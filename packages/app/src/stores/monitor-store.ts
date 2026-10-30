import { create } from 'zustand'

export interface MonitorMetrics {
  systemInfo: {
    os: string
    hostname: string
    cpuModel: string
    arch: string
    loadAvg: string
    uptimeSeconds: number
    cpuCores: number
  }
  cpu: {
    usage: number
    cores: number
  }
  memory: {
    total: number
    used: number
    free: number
    usagePercent: number
    swapUsed: number
    swapTotal: number
  }
  disk: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  disks: Array<{
    mountPoint: string
    usedBytes: number
    totalBytes: number
  }>
  network: {
    bytesIn: number
    bytesOut: number
    packetsIn: number
    packetsOut: number
  }
  timestamp: number
  sshLatencyMs: number
  docker?: {
    containersRunning: number
    containersTotal: number
    dockerInstalled: boolean
  }
}

type SubscriberCallback = (metrics: MonitorMetrics) => void

interface MonitorStoreState {
  metrics: Map<string, MonitorMetrics>
  subscribers: Map<string, Set<SubscriberCallback>>
  getMetrics: (serverId: string) => MonitorMetrics | undefined
  publishMetrics: (serverId: string, metrics: MonitorMetrics) => void
  subscribe: (serverId: string, callback: SubscriberCallback) => () => void
  clearMetrics: (serverId: string) => void
  clearAll: () => void
}

export const useMonitorStore = create<MonitorStoreState>((set, get) => ({
  metrics: new Map<string, MonitorMetrics>(),
  subscribers: new Map<string, Set<SubscriberCallback>>(),

  getMetrics: (serverId) => get().metrics.get(serverId),

  publishMetrics: (serverId, metrics) => {
    set((state) => {
      const nextMetrics = new Map(state.metrics)
      nextMetrics.set(serverId, metrics)
      return { metrics: nextMetrics }
    })

    get().subscribers.get(serverId)?.forEach((callback) => {
      try {
        callback(metrics)
      } catch (error) {
        console.error('[MonitorStore] 订阅者回调执行失败:', error)
      }
    })
  },

  subscribe: (serverId, callback) => {
    set((state) => {
      const nextSubscribers = new Map(state.subscribers)
      const serverSubscribers = new Set(nextSubscribers.get(serverId))
      serverSubscribers.add(callback)
      nextSubscribers.set(serverId, serverSubscribers)
      return { subscribers: nextSubscribers }
    })

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false

      set((state) => {
        const nextSubscribers = new Map(state.subscribers)
        const serverSubscribers = new Set(nextSubscribers.get(serverId))
        serverSubscribers.delete(callback)

        if (serverSubscribers.size > 0) {
          nextSubscribers.set(serverId, serverSubscribers)
        } else {
          nextSubscribers.delete(serverId)
        }

        return { subscribers: nextSubscribers }
      })
    }
  },

  clearMetrics: (serverId) => {
    set((state) => {
      if (!state.metrics.has(serverId)) return state
      const nextMetrics = new Map(state.metrics)
      nextMetrics.delete(serverId)
      return { metrics: nextMetrics }
    })
  },

  clearAll: () => {
    set({
      metrics: new Map(),
      subscribers: new Map(),
    })
  },
}))
