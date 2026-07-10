import { getApiUrl, getAuthHeaders } from "@/lib/api-client"

export interface RealtimeEvent<TData = Record<string, unknown>> {
  id: string
  type: string
  data: TData
  created_at: string
}

export type RealtimeEventListener = (event: RealtimeEvent) => void

class RealtimeEventStream {
  private readonly listeners = new Set<RealtimeEventListener>()
  private controller: AbortController | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0

  subscribe(listener: RealtimeEventListener): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.connect()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  private connect() {
    if (this.controller || this.reconnectTimer || this.listeners.size === 0) return
    const controller = new AbortController()
    this.controller = controller

    void fetch(getApiUrl("/events/stream"), {
      headers: { ...getAuthHeaders(), Accept: "text/event-stream" },
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Realtime stream failed with HTTP ${response.status}`)
      if (!response.body) throw new Error("Realtime stream response body is unavailable")
      this.reconnectAttempt = 0
      await this.read(response.body, controller.signal)
      if (!controller.signal.aborted) this.scheduleReconnect()
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.warn("Realtime event stream disconnected:", error)
        this.scheduleReconnect()
      }
    }).finally(() => {
      if (this.controller === controller) this.controller = null
    })
  }

  private async read(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, "\n")
        let boundary = buffer.indexOf("\n\n")
        while (boundary >= 0) {
          this.dispatchBlock(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf("\n\n")
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private dispatchBlock(block: string) {
    if (!block || block.startsWith(":")) return
    let eventType = "message"
    const dataLines: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim()
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length === 0) return
    try {
      const event = JSON.parse(dataLines.join("\n")) as RealtimeEvent
      event.type ||= eventType
      for (const listener of this.listeners) {
        try {
          listener(event)
        } catch (error) {
          console.error("Realtime event listener failed:", error)
        }
      }
    } catch {
      // 下一次状态刷新会补回无法解析的单个提示事件。
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.listeners.size === 0) return
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private stop() {
    this.controller?.abort()
    this.controller = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnectAttempt = 0
  }
}

const realtimeEventStream = new RealtimeEventStream()

export function subscribeRealtimeEvents(listener: RealtimeEventListener): () => void {
  return realtimeEventStream.subscribe(listener)
}
