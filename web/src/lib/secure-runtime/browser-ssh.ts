import { createAuthTicket } from "@/lib/auth-ticket"
import { getWsUrl } from "@/lib/config"
import { apiFetch } from "@/lib/api-client"
import type { AuthMethod } from "@/lib/server-types"

export type BrowserSSHTarget = { id: string; host: string; port: number; username: string; auth_method: AuthMethod }
export type BrowserSSHCredentials = { password: string; private_key: string; passphrase: string }
export type BrowserHostKey = { id: string; host: string; fingerprint: string; algorithm: string }
export type BrowserAuthPrompt = { id: string; user: string; instruction: string; questions: string[]; echoes: boolean[] }
export type BrowserFile = { name: string; size: number; directory: boolean; mode: string }
type SSHCallbacks = {
  output(data: Uint8Array, consumed: () => void): void
  hostKey(prompt: BrowserHostKey): void
  auth(prompt: BrowserAuthPrompt): void
  ready(): void
  error(message: string): void
  closed(): void
}
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

export function decodeBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (byte) => byte.charCodeAt(0))
}
export function encodeBytes(value: Uint8Array): string {
  let text = ""
  for (let offset = 0; offset < value.length; offset += 8192) text += String.fromCharCode(...value.subarray(offset, offset + 8192))
  return btoa(text)
}

export class BrowserSSHClient {
  private worker: Worker
  private closed = false
  private ready = false
  private sequence = 0
  private inputQueue: Uint8Array[] = []
  private inputBytes = 0
  private inputPending = false
  private pending = new Map<string, Pending>()
  private loaded: Promise<void>
  private resolveLoaded!: () => void
  private rejectLoaded!: (error: Error) => void
  private bootTimer: ReturnType<typeof setTimeout>

  constructor(private callbacks: SSHCallbacks) {
    this.loaded = new Promise((resolve, reject) => { this.resolveLoaded = resolve; this.rejectLoaded = reject })
    // Connect observes this rejection; closing an unused client must not produce
    // an unhandled rejection before connect has attached its handler.
    void this.loaded.catch(() => {})
    this.worker = new Worker(new URL("./ssh.worker.ts", import.meta.url), { type: "module" })
    this.bootTimer = setTimeout(() => this.fail("Browser SSH runtime startup timed out"), 30000)
    this.worker.onerror = () => this.fail("Browser SSH worker failed")
    this.worker.onmessage = (event: MessageEvent<string>) => {
      if (this.closed) return
      try {
        const message = JSON.parse(event.data)
        switch (message.type) {
          case "runtime_ready": clearTimeout(this.bootTimer); this.resolveLoaded(); break
          case "ready": this.ready = true; callbacks.ready(); break
          case "input_ack": {
            const sent = this.inputQueue.shift()
            if (sent) this.inputBytes -= sent.length
            this.inputPending = false
            this.flushInput()
            break
          }
          case "output": {
            let acknowledged = false
            callbacks.output(decodeBytes(message.data), () => {
              if (!acknowledged) { acknowledged = true; this.send({ type: "output_ack" }) }
            })
            break
          }
          case "host_key": callbacks.hostKey(message.data as BrowserHostKey); break
          case "auth_prompt": callbacks.auth(message.data as BrowserAuthPrompt); break
          case "error": callbacks.error(String(message.data)); break
          case "closed": this.close(); break
          case "result": {
            const result = message.data
            const pending = this.pending.get(result.id)
            if (!pending) break
            this.pending.delete(result.id)
            clearTimeout(pending.timer)
            if (result.error) pending.reject(new Error(result.error))
            else pending.resolve(result.result)
            break
          }
        }
      } catch { this.fail("Invalid browser SSH runtime response") }
    }
  }

  async connect(target: BrowserSSHTarget, credentials: BrowserSSHCredentials, cols: number, rows: number, sftpOnly = false) {
    await this.loaded
    if (this.closed) throw new Error("SSH connection is closed")
    await apiFetch("/sync/routes", { method: "POST", body: { id: target.id, host: target.host, port: target.port } })
    if (this.closed) throw new Error("SSH connection is closed")
    const { ticket } = await createAuthTicket({ type: "ws_ssh_relay", server_id: target.id })
    if (this.closed) throw new Error("SSH connection is closed")
    const url = getWsUrl(`/api/v1/ssh/relay/${encodeURIComponent(target.id)}?ticket=${encodeURIComponent(ticket)}`)
    const address = new URL(url)
    if (address.protocol !== "wss:" && !["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)) {
      throw new Error("Browser SSH requires HTTPS outside localhost")
    }
    this.send({ type: "connect", url, target, credentials, cols, rows, sftp_only: sftpOnly })
  }

  private send(message: Record<string, unknown>) {
    if (!this.closed) this.worker.postMessage(JSON.stringify(message))
  }
  input(data: string) {
    if (!this.ready) return
    if (data.length > 1 << 20) { this.fail("Terminal input exceeds the 1 MiB queue limit"); return }
    // Chunk bytes rather than UTF-16 strings so a boundary cannot corrupt an
    // emoji/surrogate pair in a pasted command.
    const bytes = new TextEncoder().encode(data)
    if (this.inputBytes + bytes.length > 1 << 20) { this.fail("Terminal input exceeds the 1 MiB queue limit"); return }
    for (let offset = 0; offset < bytes.length; offset += 32 << 10) this.inputQueue.push(bytes.slice(offset, offset + (32 << 10)))
    this.inputBytes += bytes.length
    this.flushInput()
  }
  private flushInput() {
    if (this.closed || this.inputPending || !this.inputQueue.length) return
    this.inputPending = true
    this.send({ type: "input", data: encodeBytes(this.inputQueue[0]) })
  }
  resize(cols: number, rows: number) { this.send({ type: "resize", cols, rows }) }
  trust(prompt: BrowserHostKey, accepted: boolean) { this.send({ type: "reply", id: prompt.id, accepted, fingerprint: prompt.fingerprint }) }
  answer(prompt: BrowserAuthPrompt, answers: string[], accepted = true) { this.send({ type: "reply", id: prompt.id, answers, accepted }) }

  request<T>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("SSH connection is closed"))
    if (this.pending.size >= 8) return Promise.reject(new Error("Too many pending file operations"))
    const id = String(++this.sequence)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // An upload/open may have completed remotely. Close the connection on
        // timeout so an orphaned request cannot keep writing after UI cancellation.
        this.fail("SFTP operation timed out")
      }, 60000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.send({ ...fields, type, id })
    })
  }

  private fail(message: string) { if (!this.closed) { this.callbacks.error(message); this.close() } }
  close() {
    if (this.closed) return
    this.closed = true
    this.ready = false
    clearTimeout(this.bootTimer)
    this.rejectLoaded(new Error("SSH connection is closed"))
    this.worker.terminate()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("SSH connection is closed")) }
    this.pending.clear()
    this.inputQueue = []
    this.inputBytes = 0
    this.inputPending = false
    this.callbacks.closed()
  }
}
