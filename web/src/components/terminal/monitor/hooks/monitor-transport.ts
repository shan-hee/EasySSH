import { createAuthTicket } from '@/lib/auth-ticket'
import { getWsUrl } from '@/lib/config'
import { monitor } from '@/lib/proto/metrics'
import type {
  WorkspaceMonitorApi,
  WorkspaceMonitorMetrics,
} from '@/lib/session/workspace'
import {
  useMonitorStore,
  type MonitorMetrics as StoreMonitorMetrics,
} from '@/stores/monitor-store'

interface MonitorTransportOptions {
  serverId: string
  interval: number
  monitorApi?: WorkspaceMonitorApi
}

interface MonitorTransport extends MonitorTransportOptions {
  refs: number
  generation: number
  reconnectAttempts: number
  connecting: boolean
  ws: WebSocket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  pollingTimer: ReturnType<typeof setTimeout> | null
  destroyTimer: ReturnType<typeof setTimeout> | null
}

type PollingMonitorApi = WorkspaceMonitorApi & {
  collectMetrics: NonNullable<WorkspaceMonitorApi['collectMetrics']>
}

type WebSocketMonitorApi = WorkspaceMonitorApi & {
  createWebSocketUrl: NonNullable<WorkspaceMonitorApi['createWebSocketUrl']>
}

const transports = new Map<string, MonitorTransport>()

const isPollingApi = (
  monitorApi: WorkspaceMonitorApi | undefined,
): monitorApi is PollingMonitorApi => Boolean(
  monitorApi?.collectMetrics && !monitorApi.createWebSocketUrl,
)

const isSameApi = (
  current: WorkspaceMonitorApi | undefined,
  next: WorkspaceMonitorApi | undefined,
) => current === next || (
  current?.collectMetrics === next?.collectMetrics &&
  current?.createAuthTicket === next?.createAuthTicket &&
  current?.createWebSocketUrl === next?.createWebSocketUrl &&
  current?.WebSocketCtor === next?.WebSocketCtor
)

const toStoreMetrics = (metrics: WorkspaceMonitorMetrics): StoreMonitorMetrics => {
  const ramTotal = metrics.memory.ramTotalBytes
  const disks = metrics.disks

  return {
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
      usage: metrics.cpu.usagePercent,
      cores: metrics.cpu.coreCount,
    },
    memory: {
      total: ramTotal,
      used: metrics.memory.ramUsedBytes,
      free: Math.max(0, ramTotal - metrics.memory.ramUsedBytes),
      usagePercent: ramTotal > 0
        ? (metrics.memory.ramUsedBytes / ramTotal) * 100
        : 0,
      swapUsed: metrics.memory.swapUsedBytes,
      swapTotal: metrics.memory.swapTotalBytes,
    },
    disk: {
      total: disks.reduce((total, disk) => total + disk.totalBytes, 0),
      used: disks.reduce((total, disk) => total + disk.usedBytes, 0),
      free: disks.reduce(
        (total, disk) => total + Math.max(0, disk.totalBytes - disk.usedBytes),
        0,
      ),
      usagePercent: metrics.diskTotalPercent,
    },
    disks,
    network: {
      bytesIn: metrics.network.bytesRecvPerSec,
      bytesOut: metrics.network.bytesSentPerSec,
      packetsIn: 0,
      packetsOut: 0,
    },
    timestamp: metrics.timestamp,
    sshLatencyMs: metrics.sshLatencyMs,
    docker: metrics.docker,
  }
}

const decodeMetrics = (data: ArrayBuffer): WorkspaceMonitorMetrics => {
  const metrics = monitor.SystemMetrics.decode(new Uint8Array(data))

  return {
    systemInfo: {
      os: metrics.systemInfo?.os || '',
      hostname: metrics.systemInfo?.hostname || '',
      cpuModel: metrics.systemInfo?.cpuModel || '',
      arch: metrics.systemInfo?.arch || '',
      loadAvg: metrics.systemInfo?.loadAvg || '',
      uptimeSeconds: Number(metrics.systemInfo?.uptimeSeconds || 0),
      cpuCores: metrics.systemInfo?.cpuCores || 0,
    },
    cpu: {
      usagePercent: metrics.cpu?.usagePercent || 0,
      coreCount: metrics.cpu?.coreCount || 0,
    },
    memory: {
      ramUsedBytes: Number(metrics.memory?.ramUsedBytes || 0),
      ramTotalBytes: Number(metrics.memory?.ramTotalBytes || 0),
      swapUsedBytes: Number(metrics.memory?.swapUsedBytes || 0),
      swapTotalBytes: Number(metrics.memory?.swapTotalBytes || 0),
    },
    network: {
      bytesRecvPerSec: Number(metrics.network?.bytesRecvPerSec || 0),
      bytesSentPerSec: Number(metrics.network?.bytesSentPerSec || 0),
    },
    disks: (metrics.disks || []).map((disk) => ({
      mountPoint: disk.mountPoint || '',
      usedBytes: Number(disk.usedBytes || 0),
      totalBytes: Number(disk.totalBytes || 0),
    })),
    diskTotalPercent: metrics.diskTotalPercent || 0,
    sshLatencyMs: Number(metrics.sshLatencyMs || 0),
    timestamp: Number(metrics.timestamp || 0),
    docker: metrics.docker ? {
      containersRunning: metrics.docker.containersRunning || 0,
      containersTotal: metrics.docker.containersTotal || 0,
      dockerInstalled: metrics.docker.dockerInstalled || false,
    } : undefined,
  }
}

const isCurrentTransport = (transport: MonitorTransport, generation: number) => (
  transports.get(transport.serverId) === transport &&
  transport.refs > 0 &&
  transport.generation === generation
)

const clearTimer = (
  timer: ReturnType<typeof setTimeout> | null,
) => {
  if (timer !== null) clearTimeout(timer)
}

const closeSocket = (transport: MonitorTransport, reason: string) => {
  const ws = transport.ws
  transport.ws = null
  if (!ws) return

  ws.onopen = null
  ws.onmessage = null
  ws.onclose = null
  ws.onerror = null

  if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
    ws.close(1000, reason)
  }
}

const scheduleReconnect = (transport: MonitorTransport) => {
  transport.reconnectAttempts = Math.min(transport.reconnectAttempts + 1, 5)
  const generation = transport.generation
  const delay = Math.min(1000 * 2 ** transport.reconnectAttempts, 30000)

  clearTimer(transport.reconnectTimer)
  transport.reconnectTimer = setTimeout(() => {
    transport.reconnectTimer = null
    if (!isCurrentTransport(transport, generation)) return
    restartTransport(transport)
  }, delay)
}

const startPolling = (transport: MonitorTransport, generation: number) => {
  const monitorApi = transport.monitorApi
  if (!isPollingApi(monitorApi)) return

  const collect = async () => {
    if (!isCurrentTransport(transport, generation) || transport.connecting) return
    transport.connecting = true

    try {
      const metrics = await monitorApi.collectMetrics(transport.serverId, {
        intervalSeconds: transport.interval,
      })
      if (!isCurrentTransport(transport, generation)) return
      useMonitorStore.getState().publishMetrics(
        transport.serverId,
        toStoreMetrics(metrics),
      )
    } catch (error) {
      if (isCurrentTransport(transport, generation)) {
        console.error('[Monitor Polling] 采集失败:', error)
      }
    } finally {
      if (isCurrentTransport(transport, generation)) {
        transport.connecting = false
        transport.pollingTimer = setTimeout(
          collect,
          Math.max(1000, transport.interval * 1000),
        )
      }
    }
  }

  void collect()
}

const getWebSocketUrl = async (transport: MonitorTransport) => {
  const monitorApi = transport.monitorApi as WebSocketMonitorApi | undefined
  const ticket = monitorApi?.createAuthTicket
    ? await monitorApi.createAuthTicket({
        type: 'ws_monitor',
        server_id: transport.serverId,
      })
    : (await createAuthTicket({
        type: 'ws_monitor',
        server_id: transport.serverId,
      })).ticket

  if (monitorApi?.createWebSocketUrl) {
    return monitorApi.createWebSocketUrl({
      serverId: transport.serverId,
      interval: transport.interval,
      ticket,
    })
  }

  const params = new URLSearchParams({
    interval: String(transport.interval),
    ticket,
  })
  return getWsUrl(`/api/v1/monitor/server/${transport.serverId}?${params.toString()}`)
}

const startWebSocket = async (transport: MonitorTransport, generation: number) => {
  transport.connecting = true

  try {
    const wsUrl = await getWebSocketUrl(transport)
    if (!isCurrentTransport(transport, generation)) return

    const SocketCtor = transport.monitorApi?.WebSocketCtor ?? WebSocket
    const ws = new SocketCtor(wsUrl)
    ws.binaryType = 'arraybuffer'
    transport.ws = ws
    transport.connecting = false

    ws.onopen = () => {
      if (!isCurrentTransport(transport, generation) || transport.ws !== ws) return
      transport.reconnectAttempts = 0
    }

    ws.onmessage = (event) => {
      if (!isCurrentTransport(transport, generation) || transport.ws !== ws) return

      if (event.data instanceof ArrayBuffer) {
        try {
          useMonitorStore.getState().publishMetrics(
            transport.serverId,
            toStoreMetrics(decodeMetrics(event.data)),
          )
        } catch (error) {
          console.error('[Monitor WS] 解析数据失败:', error)
        }
        return
      }

      if (typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data)
        if (message?.type === 'error') {
          console.error(
            '[Monitor WS] 服务端返回错误:',
            new Error(message.message || 'Monitoring connection failed'),
          )
        }
      } catch {
        // 忽略非 JSON 控制消息。
      }
    }

    ws.onclose = () => {
      if (!isCurrentTransport(transport, generation) || transport.ws !== ws) return
      transport.ws = null
      scheduleReconnect(transport)
    }

    ws.onerror = (error) => {
      if (!isCurrentTransport(transport, generation) || transport.ws !== ws) return
      console.error('[Monitor WS] 连接错误:', error)
    }
  } catch (error) {
    if (!isCurrentTransport(transport, generation)) return
    transport.connecting = false
    console.error('[Monitor WS] 创建连接失败:', error)
    scheduleReconnect(transport)
  }
}

function restartTransport(transport: MonitorTransport) {
  transport.generation += 1
  transport.connecting = false
  clearTimer(transport.reconnectTimer)
  clearTimer(transport.pollingTimer)
  transport.reconnectTimer = null
  transport.pollingTimer = null
  closeSocket(transport, 'Monitoring transport restarted')

  const generation = transport.generation
  if (isPollingApi(transport.monitorApi)) {
    startPolling(transport, generation)
  } else {
    void startWebSocket(transport, generation)
  }
}

const ensureTransportStarted = (transport: MonitorTransport) => {
  const wsActive = transport.ws && (
    transport.ws.readyState === WebSocket.CONNECTING ||
    transport.ws.readyState === WebSocket.OPEN
  )
  if (transport.connecting || transport.pollingTimer !== null || wsActive) return
  restartTransport(transport)
}

const destroyTransport = (transport: MonitorTransport) => {
  if (transport.refs > 0 || transports.get(transport.serverId) !== transport) return

  transports.delete(transport.serverId)
  transport.generation += 1
  transport.connecting = false
  clearTimer(transport.reconnectTimer)
  clearTimer(transport.pollingTimer)
  clearTimer(transport.destroyTimer)
  closeSocket(transport, 'Monitoring transport released')
  useMonitorStore.getState().clearMetrics(transport.serverId)
}

export const acquireMonitorTransport = ({
  serverId,
  interval,
  monitorApi,
}: MonitorTransportOptions) => {
  let transport = transports.get(serverId)

  if (!transport) {
    transport = {
      serverId,
      interval,
      monitorApi,
      refs: 0,
      generation: 0,
      reconnectAttempts: 0,
      connecting: false,
      ws: null,
      reconnectTimer: null,
      pollingTimer: null,
      destroyTimer: null,
    }
    transports.set(serverId, transport)
  }

  const activeTransport = transport
  clearTimer(activeTransport.destroyTimer)
  activeTransport.destroyTimer = null
  activeTransport.refs += 1

  const optionsChanged = (
    activeTransport.interval !== interval ||
    !isSameApi(activeTransport.monitorApi, monitorApi)
  )

  if (optionsChanged) {
    activeTransport.interval = interval
    activeTransport.monitorApi = monitorApi
    activeTransport.reconnectAttempts = 0
    restartTransport(activeTransport)
  } else {
    ensureTransportStarted(activeTransport)
  }

  let acquired = true
  return () => {
    if (!acquired) return
    acquired = false
    activeTransport.refs = Math.max(0, activeTransport.refs - 1)

    if (activeTransport.refs === 0) {
      activeTransport.destroyTimer = setTimeout(
        () => destroyTransport(activeTransport),
        0,
      )
    }
  }
}

export const destroyAllMonitorTransports = () => {
  const activeTransports = [...transports.values()]
  activeTransports.forEach((transport) => {
    transport.refs = 0
    destroyTransport(transport)
  })
  useMonitorStore.getState().clearAll()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', destroyAllMonitorTransports)
}
