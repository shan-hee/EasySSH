import type { RemoteDesktopSocketFactory } from "@easyssh/app/lib/session/workspace"
import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import { decodeRemoteBytes, readRemoteStream } from "./remote-stream"
import { remoteAccessEnded, setRemoteAvailable } from "./remote-transport"

const MAX_FRAME_BYTES = 1 << 20
const MAX_QUEUED_BYTES = 2 << 20

/** A WebSocket-shaped byte channel over the window-scoped native connection. */
class RemoteDesktopSocket extends EventTarget implements WebSocket {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readonly extensions = ""
  readonly protocol: string
  readonly url: string
  binaryType: BinaryType = "arraybuffer"
  bufferedAmount = 0
  readyState: number = 0
  onopen: WebSocket["onopen"] = null
  onclose: WebSocket["onclose"] = null
  onerror: WebSocket["onerror"] = null
  onmessage: WebSocket["onmessage"] = null
  private stream = ""
  private stop?: () => void
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly connectionId: string, private readonly mode: "vnc" | "rdp") {
    super()
    this.protocol = mode === "vnc" ? "binary" : "easyssh-rdp-v1"
    this.url = `remote://${mode}/${connectionId}`
    queueMicrotask(() => { void this.open().catch(error => this.fail(error)) })
  }

  addEventListener<K extends keyof WebSocketEventMap>(type: K, listener: (this: WebSocket, event: WebSocketEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, listener, options)
  }
  removeEventListener<K extends keyof WebSocketEventMap>(type: K, listener: (this: WebSocket, event: WebSocketEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    super.removeEventListener(type, listener, options)
  }

  private emit(type: "open" | "close" | "error" | "message", event: Event) {
    const handler = this[`on${type}`] as ((this: WebSocket, event: Event) => unknown) | null
    handler?.call(this, event)
    this.dispatchEvent(event)
  }

  private async open() {
    if (this.readyState !== this.CONNECTING) return
    const stream = await Remote.OpenRemoteDesktop(this.connectionId, this.mode)
    if (this.readyState !== this.CONNECTING) {
      await Remote.CloseStream(stream.id)
      return
    }
    this.stream = stream.id
    this.readyState = this.OPEN
    this.emit("open", new Event("open"))
    if (this.readyState !== this.OPEN) return
    this.stop = readRemoteStream(stream.id, frame => {
      if (frame.encoding !== (this.mode === "vnc" ? "vnc.bytes" : "rdp.json")) throw new Error("Invalid remote desktop frame")
      const bytes = decodeRemoteBytes(frame.data)
      const data = this.mode === "rdp" ? new TextDecoder().decode(bytes)
        : this.binaryType === "blob" ? new Blob([bytes]) : bytes.buffer
      this.emit("message", new MessageEvent("message", { data }))
    }, reason => this.fail(new Error(reason || "remote_stream_closed")))
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState === this.CONNECTING) throw new DOMException("Socket is not open", "InvalidStateError")
    if (this.readyState !== this.OPEN) return
    // noVNC reuses its send buffer immediately. Copy before queuing the IPC call.
    const payload = typeof data === "string" ? new TextEncoder().encode(data)
      : data instanceof Blob ? data
        : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
          : new Uint8Array(data).slice()
    const size = payload instanceof Blob ? payload.size : payload.byteLength
    if (size === 0) return
    if (size > MAX_FRAME_BYTES || this.bufferedAmount + size > MAX_QUEUED_BYTES) {
      this.fail(new Error("Remote desktop send buffer exceeded"))
      return
    }
    this.bufferedAmount += size
    this.writes = this.writes.then(async () => {
      if (this.readyState !== this.OPEN) return
      const bytes = payload instanceof Blob ? new Uint8Array(await payload.arrayBuffer()) : payload
      if (this.readyState !== this.OPEN) return
      let binary = ""
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      }
      await Remote.WriteRemoteDesktop(this.stream, btoa(binary))
    }).catch(error => this.fail(error)).finally(() => { this.bufferedAmount -= size })
  }

  close(code = 1000, reason = "closed") {
    if (this.readyState === this.CLOSED) return
    this.readyState = this.CLOSED
    this.stop?.()
    if (this.stream) void Remote.CloseStream(this.stream).catch(() => undefined)
    this.emit("close", new CloseEvent("close", { code, reason, wasClean: code === 1000 }))
  }

  private fail(error: unknown) {
    if (this.readyState === this.CLOSED) return
    if (remoteAccessEnded(error)) setRemoteAvailable(false)
    this.emit("error", new Event("error"))
    this.close(1011, "Remote desktop connection failed")
  }
}

export const createRemoteDesktopSocket: RemoteDesktopSocketFactory = (id, mode) => new RemoteDesktopSocket(id, mode)
