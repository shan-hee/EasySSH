export type Scope = "config" | "credentials" | "ai_config" | "sessions"
export const allScopes: Scope[] = ["config", "credentials", "ai_config", "sessions"]
export type PublicDevice = { id: string; signing_key: string; recipient: string; name: string }
export type Grant = { device: PublicDevice; scopes: Scope[]; admin: boolean; envelope: string }
export type Manifest = {
  version: number; space: string; genesis_root: string; root: string; revision: number; previous: string
  epochs: Record<Scope, number>; devices: Grant[]; recovery_recipient: string; recovery: string
  signature: string; previous_signature: string
}
export type EncryptedObject = {
  version: number; space: string; manifest: string; scope: Scope; epoch: number; document: string
  id: string; parents: string[]; author: string; ciphertext: string; signature: string
}
export type CryptoView = { device: PublicDevice; manifest: Manifest; manifest_hash: string; scopes: Scope[]; admin: boolean }
export type LocalEnvelope = { version: number; salt: string; ciphertext: string }
export interface CryptoRPC { call<T>(operation: string, input?: Record<string, unknown>): Promise<T>; close(): void }

export class BrowserCrypto implements CryptoRPC {
  private worker: Worker
  private next = 0
  private closed = false
  private ready: Promise<void>
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  constructor() {
    this.worker = new Worker(new URL("./crypto.worker.ts", import.meta.url), { type: "module" })
    this.ready = new Promise<void>((resolve, reject) => {
      this.pending.set("ready", { resolve: () => resolve(), reject, timer: setTimeout(() => this.close(), 45000) })
    })
    void this.ready.catch(() => {})
    this.worker.onerror = () => this.close()
    this.worker.onmessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data)
        if (message.id === "fatal") { this.close(); return }
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id); clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error))
        else pending.resolve(JSON.parse(message.result))
      } catch { this.close() }
    }
  }
  async call<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
    await this.ready
    if (this.closed) throw new Error("Encrypted workspace is locked")
    if (this.pending.size >= 16) throw new Error("Too many pending encryption requests")
    const id = String(++this.next)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer: setTimeout(() => this.close(), 120000) })
      this.worker.postMessage(JSON.stringify({ id, payload: JSON.stringify({ ...input, operation }) }))
    })
  }
  close() {
    if (this.closed) return
    this.closed = true; this.worker.terminate()
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Encrypted workspace is locked or unavailable")) }
    this.pending.clear()
  }
}
