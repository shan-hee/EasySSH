import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  WorkspaceMonitorApi,
  WorkspaceMonitorMetrics,
} from '@/lib/session/workspace'
import { useMonitorStore } from '@/stores/monitor-store'
import { acquireMonitorTransport } from './monitor-transport'

export type MonitorMetrics = WorkspaceMonitorMetrics

interface UseMonitorWebSocketOptions {
  serverId: string
  enabled?: boolean
  interval?: number
  monitorApi?: WorkspaceMonitorApi
}

const METRICS_HISTORY_LIMIT = 20

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
  const metrics = (serverId ? useMonitorStore.getState().getMetrics(serverId) : undefined) ?? null

  return {
    metrics,
    history: metrics ? [metrics] : [],
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

    const receiveMetrics = (nextMetrics: MonitorMetrics) => {
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
