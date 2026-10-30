import { remoteAccessEnded, setRemoteAvailable } from "./remote-transport"
import { ConnectionMode } from "../../bindings/github.com/easyssh/shared/protocol/models"
import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import { decodeRemoteBytes, readRemoteStream } from "./remote-stream"
import type { TerminalWebSocketConstructor } from "@easyssh/app/lib/websocket-terminal"

/** WebSocket-shaped adapter over the existing native, window-scoped remote stream. */
class RemoteSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readonly url: string
  readonly protocol = ""
  readonly extensions = ""
  binaryType: BinaryType = "arraybuffer"
  bufferedAmount = 0
  readyState = 0
  onopen: WebSocket["onopen"] = null
  onclose: WebSocket["onclose"] = null
  onmessage: WebSocket["onmessage"] = null
  onerror: WebSocket["onerror"] = null
  private stream = ""
  private connection = ""
  private stop?: () => void
  private heartbeat?: ReturnType<typeof setInterval>
  private writes: Promise<void> = Promise.resolve()
  private readonly decoder = new TextDecoder()
  private readonly mode: "terminal" | "monitor"
  private readonly pings = new Map<string, unknown>()
  constructor(url: string | URL) {
    super()
    this.url = String(url)
    const parsed = new URL(this.url)
    this.mode = parsed.hostname === "monitor" ? "monitor" : "terminal"
    queueMicrotask(() => {
      void this.open(parsed).catch((e) => this.fail(e))
    })
  }
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, event: WebSocketEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    super.addEventListener(type, listener, options)
  }
  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, event: WebSocketEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    super.removeEventListener(type, listener, options)
  }
  private isClosed() {
    return this.readyState === 3
  }
  private emit(type: "open" | "error" | "message" | "close", event: Event) {
    const handler = this[`on${type}`] as
      | ((this: WebSocket, e: Event) => unknown)
      | null
    handler?.call(this as unknown as WebSocket, event)
    this.dispatchEvent(event)
  }
  private async open(url: URL) {
    const connection = await Remote.CreateConnection(
      url.searchParams.get("serverId") || "",
      this.mode === "terminal"
        ? ConnectionMode.TerminalConnection
        : ConnectionMode.MonitorConnection,
    )
    if (this.isClosed()) {
      await Remote.CloseConnection(connection.id)
      return
    }
    this.connection = connection.id
    this.heartbeat = setInterval(
      () => {
        void Remote.HeartbeatConnection(this.connection).catch((e) =>
          this.fail(e),
        )
      },
      Math.max(5, connection.heartbeat_seconds) * 1000,
    )
    const stream =
      this.mode === "terminal"
        ? await Remote.OpenTerminal(
            connection.id,
            Number(url.searchParams.get("cols")) || 80,
            Number(url.searchParams.get("rows")) || 24,
          )
        : await Remote.OpenMonitor(
            connection.id,
            Number(url.searchParams.get("interval")) || 2,
          )
    this.stream = stream.id
    if (this.isClosed()) {
      await Remote.CloseStream(stream.id)
      return
    }
    this.readyState = 1
    this.emit("open", new Event("open"))
    this.stop = readRemoteStream(
      stream.id,
      (frame) => {
        const bytes = decodeRemoteBytes(frame.data)
        if (frame.encoding === "event.json") {
          const text = new TextDecoder().decode(bytes)
          const event = JSON.parse(text) as {
            type?: string
            data?: Record<string, unknown>
          }
          // Native ping IDs differ from the shared terminal's request ID.
          if (event.type === "pong" && event.data) {
            const original = this.pings.get(String(event.data.id))
            if (original) {
              this.pings.delete(String(event.data.id))
              Object.assign(event.data, original)
            }
          }
          this.emit(
            "message",
            new MessageEvent("message", { data: JSON.stringify(event) }),
          )
        } else if (
          frame.encoding === "terminal.bytes" ||
          frame.encoding === "monitor.protobuf"
        ) {
          this.emit(
            "message",
            new MessageEvent("message", {
              data:
                this.binaryType === "blob" ? new Blob([bytes]) : bytes.buffer,
            }),
          )
        } else throw new Error("Unexpected remote stream frame")
      },
      (reason) => this.close(reason ? 1011 : 1000, reason || "closed"),
    )
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== 1 || this.mode !== "terminal") return
    this.writes = this.writes
      .then(async () => {
        if (typeof data !== "string") {
          const bytes =
            data instanceof Blob
              ? new Uint8Array(await data.arrayBuffer())
              : ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data)
          const input = this.decoder.decode(bytes, { stream: true })
          if (input) await Remote.WriteTerminal(this.stream, input)
          return
        }
        const msg = JSON.parse(data) as {
          type: string
          data?: Record<string, unknown>
        }
        const d = msg.data ?? {}
        if (msg.type === "input")
          await Remote.WriteTerminal(this.stream, String(d.data ?? ""))
        else if (msg.type === "resize")
          await Remote.ResizeTerminal(
            this.stream,
            Number(d.cols),
            Number(d.rows),
          )
        else if (msg.type === "auth_response")
          await Remote.AnswerTerminalChallenge(
            this.stream,
            String(d.request_id),
            Array.isArray(d.answers) ? d.answers.map(String) : [],
            !!d.cancelled,
          )
        else if (msg.type === "ping") {
          const id = await Remote.PingTerminal(this.stream)
          this.pings.set(id, d)
          if (this.pings.size > 20)
            this.pings.delete(this.pings.keys().next().value!)
        } else if (msg.type === "fetch_completion_data")
          await Remote.RequestTerminalCompletion(
            this.stream,
            !!d.includeHistory,
            false,
          )
      })
      .catch((e) => this.fail(e))
  }
  close(code = 1000, reason = "closed") {
    if (this.isClosed()) return
    this.readyState = 3
    clearInterval(this.heartbeat)
    this.stop?.()
    if (this.stream) void Remote.CloseStream(this.stream).catch(() => undefined)
    if (this.connection)
      void Remote.CloseConnection(this.connection).catch(() => undefined)
    this.emit(
      "close",
      new CloseEvent("close", { code, reason, wasClean: code === 1000 }),
    )
  }
  private fail(error: unknown) {
    if (this.isClosed()) return
    if (remoteAccessEnded(error)) setRemoteAvailable(false)
    this.emit("error", new Event("error"))
    this.close(1011, String(error))
  }
}
export const RemoteWebSocket: TerminalWebSocketConstructor = RemoteSocket
