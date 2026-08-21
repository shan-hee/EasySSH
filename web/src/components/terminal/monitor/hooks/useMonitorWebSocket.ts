import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  WorkspaceMonitorApi,
  WorkspaceMonitorMetrics,
} from '@/lib/session/workspace'
import {
  useMonitorStore,
  type MonitorMetrics as StoreMonitorMetrics,
} from '@/stores/monitor-store'
import { acquireMonitorTransport } from './monitor-transport'

export type MonitorMetrics = WorkspaceMonitorMetrics

interface UseMonitorWebSocketOptions {
  serverId: string
  enabled?: boolean
  interval?: number
  monitorApi?: WorkspaceMonitorApi
}

const METRICS_HISTORY_LIMIT = 20

const toHookMetrics = (metrics: StoreMonitorMetrics): MonitorMetrics => ({
  systemInfo: {
    os: metrics.systemInfo.os,
    hostname: metrics.systemInfo.hostname,
    cpuModel: metrics.systemInfo.cpuModel,
    arch: metrics.systemInfo.arch,
    loadAvg: metrics.systemInfo.loadAvg,
    uptimeSeconds: metrics.systemInfo.uptimeSeconds,
    cpuCores: metrics.systemInfo.cpuCores,
  },
  cpu: {
    usagePercent: metrics.cpu.usage,
    coreCount: metrics.cpu.cores,
  },
  memory: {
    ramUsedBytes: metrics.memory.used,
    ramTotalBytes: metrics.memory.total,
    swapUsedBytes: metrics.memory.swapUsed,
    swapTotalBytes: metrics.memory.swapTotal,
  },
  network: {
    bytesRecvPerSec: metrics.network.bytesIn,
    bytesSentPerSec: metrics.network.bytesOut,
  },
  disks: metrics.disks,
  diskTotalPercent: metrics.disk.usagePercent,
  sshLatencyMs: metrics.sshLatencyMs,
  timestamp: metrics.timestamp,
  docker: metrics.docker,
})

const appendMetricSample = (
  history: MonitorMetrics[],
  nextMetrics: MonitorMetrics,
): MonitorMetrics[] => {
  const lastMetrics = history[history.length - 1]
  if (nextMetrics.timestamp > 0 && lastMetrics?.timestamp === nextMetrics.timestamp) {
    return [...history.slice(0, -1), nextMetrics]
  }

  return [...history, nextMetrics].slice(-METRICS_HISTORY_LIMIT)
}

const getInitialSnapshot = (serverId: string) => {
  const metrics = serverId
    ? useMonitorStore.getState().getMetrics(serverId)
    : undefined
  const hookMetrics = metrics ? toHookMetrics(metrics) : null

  return {
    metrics: hookMetrics,
    history: hookMetrics ? [hookMetrics] : [],
  }
}

export function useMonitorWebSocket({
  serverId,
  enabled = true,
  interval = 2,
  monitorApi,
}: UseMonitorWebSocketOptions) {
  const initialSnapshotRef = useRef<ReturnType<typeof getInitialSnapshot> | null>(null)
  if (!initialSnapshotRef.current) {
    initialSnapshotRef.current = getInitialSnapshot(serverId)
  }

  const [metrics, setMetrics] = useState<MonitorMetrics | null>(
    initialSnapshotRef.current.metrics,
  )
  const metricsHistoryRef = useRef<MonitorMetrics[]>(
    initialSnapshotRef.current.history,
  )
  const previousServerIdRef = useRef(serverId)
  const getMetrics = useMonitorStore((state) => state.getMetrics)
  const subscribe = useMonitorStore((state) => state.subscribe)

  useEffect(() => {
    if (previousServerIdRef.current === serverId) return

    previousServerIdRef.current = serverId
    metricsHistoryRef.current = []
    setMetrics(null)
  }, [serverId])

  useEffect(() => {
    if (!enabled || !serverId) return

    const receiveMetrics = (nextStoreMetrics: StoreMonitorMetrics) => {
      const nextMetrics = toHookMetrics(nextStoreMetrics)
      setMetrics(nextMetrics)
      metricsHistoryRef.current = appendMetricSample(
        metricsHistoryRef.current,
        nextMetrics,
      )
    }

    const unsubscribe = subscribe(serverId, receiveMetrics)
    const currentMetrics = getMetrics(serverId)
    if (currentMetrics) receiveMetrics(currentMetrics)

    return unsubscribe
  }, [enabled, getMetrics, serverId, subscribe])

  useEffect(() => {
    if (!enabled || !serverId) return

    return acquireMonitorTransport({
      serverId,
      interval,
      monitorApi,
    })
  }, [enabled, interval, monitorApi, serverId])

  const getMetricsHistory = useCallback(() => metricsHistoryRef.current, [])

  return {
    metrics,
    getMetricsHistory,
  }
}
