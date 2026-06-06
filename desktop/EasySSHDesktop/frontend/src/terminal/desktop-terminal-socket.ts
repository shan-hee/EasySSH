import { Events } from "@wailsio/runtime"
import type { TerminalWebSocketConstructor } from "@easyssh/ssh-workspace/desktop"
import {
  ActivityLogService,
  DesktopActivityLogStatus,
  DesktopTerminalService,
} from "../../bindings/github.com/easyssh/easyssh-desktop"

const desktopTerminalOutputEvent = "easyssh:desktop-terminal:output"
const desktopTerminalClosedEvent = "easyssh:desktop-terminal:closed"

interface DesktopTerminalOutputPayload {
  clientId?: string
  data?: string
}

interface DesktopTerminalClosedPayload {
  clientId?: string
  reason?: string
}

const getDesktopEventData = (event: unknown) => {
  return event && typeof event === "object" && "data" in event
    ? (event as { data?: unknown }).data
    : undefined
}

const getDesktopErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
}

const encodeDesktopTerminalInput = (data: string) => {
  const bytes = new TextEncoder().encode(data)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const decodeDesktopTerminalOutput = (data: string) => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

const createDesktopTerminalClientId = () => {
  return `desktop-terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createDesktopTerminalSocket(): TerminalWebSocketConstructor {
  return class DesktopTerminalSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readonly url: string
    readonly extensions = ""
    readonly protocol = ""
    bufferedAmount = 0
    binaryType: BinaryType = "arraybuffer"
    readyState = DesktopTerminalSocket.CONNECTING
    onopen: ((this: WebSocket, ev: Event) => unknown) | null = null
    onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null
    onerror: ((this: WebSocket, ev: Event) => unknown) | null = null
    onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null

    private readonly serverId: string
    private readonly clientId = createDesktopTerminalClientId()
    private readonly cols: number
    private readonly rows: number
    private destroyed = false
    private sshPingInFlight = false
    private sshLatency: { sshLatencyMs?: number; sshLatencyMeasuredAt?: number } = {}
    private readonly disposeOutput: () => void
    private readonly disposeClosed: () => void

    constructor(url: string | URL) {
      super()
      this.url = String(url)
      const params = new URL(this.url, window.location.href).searchParams
      this.serverId = params.get("serverId") || ""
      this.cols = Number(params.get("cols")) || 80
      this.rows = Number(params.get("rows")) || 24

      this.disposeOutput = Events.On(desktopTerminalOutputEvent, (event) => {
        const data = getDesktopEventData(event) as DesktopTerminalOutputPayload | undefined
        if (!data || data.clientId !== this.clientId || !data.data) {
          return
        }

        try {
          this.emitMessage(decodeDesktopTerminalOutput(data.data))
        } catch (error) {
          this.emitError(getDesktopErrorMessage(error))
        }
      })

      this.disposeClosed = Events.On(desktopTerminalClosedEvent, (event) => {
        const data = getDesktopEventData(event) as DesktopTerminalClosedPayload | undefined
        if (!data || data.clientId !== this.clientId) {
          return
        }

        this.close(1000, data.reason || "remote closed")
      })

      window.setTimeout(() => {
        void this.start()
      }, 0)
    }

    close(code = 1000, reason = "closed") {
      if (this.readyState === DesktopTerminalSocket.CLOSED) return
      this.destroyed = true
      this.readyState = DesktopTerminalSocket.CLOSED
      this.disposeOutput()
      this.disposeClosed()
      void DesktopTerminalService.Close({ clientId: this.clientId }).catch(() => {})
      const event = new CloseEvent("close", { code, reason, wasClean: code === 1000 })
      this.onclose?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== DesktopTerminalSocket.OPEN) return
      if (typeof data === "string") {
        this.handleControlMessage(data)
        return
      }

      void DesktopTerminalService.Write({
        clientId: this.clientId,
        data: encodeDesktopTerminalInput(this.decodeInput(data)),
      }).catch((error) => this.emitError(getDesktopErrorMessage(error)))
    }

    private handleControlMessage(raw: string) {
      try {
        const message = JSON.parse(raw) as { type?: string; data?: unknown }
        if (message.type === "ping") {
          const now = Date.now()
          const data = message.data && typeof message.data === "object"
            ? message.data as Record<string, unknown>
            : {}
          this.emitControl("pong", {
            ...data,
            ...this.sshLatency,
            serverRecvTs: now,
            serverSendTs: Date.now(),
          })
          void this.refreshSshLatency()
          return
        }
        if (message.type === "resize") {
          const data = message.data && typeof message.data === "object"
            ? message.data as { cols?: number; rows?: number }
            : {}
          void DesktopTerminalService.Resize({
            clientId: this.clientId,
            cols: data.cols || this.cols,
            rows: data.rows || this.rows,
          }).catch((error) => this.emitError(getDesktopErrorMessage(error)))
          return
        }
        if (message.type === "fetch_completion_data") {
          this.emitControl("completion_data", {
            history: [],
            scripts: [],
            timestamp: Date.now(),
          })
          return
        }
        if (message.type === "completion_update") {
          return
        }
      } catch {
        // Ignore non-control strings.
      }
    }

    private async refreshSshLatency() {
      if (this.sshPingInFlight || this.destroyed || this.readyState !== DesktopTerminalSocket.OPEN) {
        return
      }

      this.sshPingInFlight = true
      try {
        const result = await DesktopTerminalService.Ping({ clientId: this.clientId })
        this.sshLatency = {
          sshLatencyMs: result.latencyMs,
          sshLatencyMeasuredAt: result.measuredAt,
        }
      } catch {
        this.sshLatency = {}
      } finally {
        this.sshPingInFlight = false
      }
    }

    private async start() {
      if (this.destroyed) return

      this.readyState = DesktopTerminalSocket.OPEN
      this.emitOpen()
      this.emitControl("handshake_complete")

      try {
        await DesktopTerminalService.Start({
          clientId: this.clientId,
          serverId: this.serverId,
          cols: this.cols,
          rows: this.rows,
        })

        if (this.destroyed) return

        this.emitControl("connected")
        void this.refreshSshLatency()
        void ActivityLogService.Record({
          action: "ssh_connect",
          resource: this.serverId,
          status: DesktopActivityLogStatus.DesktopActivityLogSuccess,
          serverId: this.serverId,
        }).catch((error) => console.error("Failed to record desktop terminal activity:", error))
      } catch (error) {
        const message = getDesktopErrorMessage(error)
        this.emitControl("error", {
          error: "initialization_failed",
          message,
        })
        void ActivityLogService.Record({
          action: "ssh_connect",
          resource: this.serverId,
          status: DesktopActivityLogStatus.DesktopActivityLogFailure,
          serverId: this.serverId,
          detail: message,
        }).catch((error) => console.error("Failed to record desktop terminal activity:", error))
        this.close(1011, message)
      }
    }

    private emitOpen() {
      const event = new Event("open")
      this.onopen?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    private emitControl(type: string, data?: unknown) {
      this.emitMessage(JSON.stringify({ type, data }))
    }

    private emitError(message: string) {
      this.emitControl("error", {
        error: "terminal_io_failed",
        message,
      })
    }

    private emitMessage(data: string | ArrayBuffer) {
      const event = new MessageEvent("message", { data })
      this.onmessage?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    private decodeInput(data: ArrayBufferLike | Blob | ArrayBufferView) {
      if (data instanceof Blob) return ""
      if (ArrayBuffer.isView(data)) {
        return new TextDecoder().decode(data)
      }
      return new TextDecoder().decode(data)
    }
  } as unknown as TerminalWebSocketConstructor
}
