import { Call } from "@wailsio/runtime"
import { EncryptedWorkspace } from "@/lib/secure-runtime/workspace"
import type { CryptoRPC } from "@/lib/secure-runtime/crypto"
import type { SecureStorage } from "@/lib/secure-runtime/storage"

const call = <T>(method: string, ...args: unknown[]): Promise<T> => Call.ByName(`main.DesktopSyncService.${method}`, ...args)
let workspace: EncryptedWorkspace | undefined
let cryptoQueue: Promise<unknown> = Promise.resolve()
function serialCrypto(owner: string, input: string): Promise<string> {
  const next = cryptoQueue.then(() => call<string>("EncryptedCrypto", owner, input))
  cryptoQueue = next.catch(() => {})
  return next
}
class NativeCrypto implements CryptoRPC {
  private closed = false
  constructor(private owner: string) {}
  async call<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) throw new Error("加密工作区已锁定")
    const result = await serialCrypto(this.owner, JSON.stringify({ ...input, operation }))
    if (this.closed) throw new Error("加密工作区已锁定")
    return JSON.parse(result) as T
  }
  close() { if (!this.closed) { this.closed = true; void serialCrypto(this.owner, JSON.stringify({ operation: "lock" })).catch(() => {}) } }
}
class NativeStorage implements SecureStorage {
  constructor(private owner: string) {}
  private async values(): Promise<Record<string, unknown>> { return JSON.parse(await call<string>("EncryptedRead", this.owner)) }
  async read<T>(key: string) { return (await this.values())[key] as T | undefined }
  async keys(prefix: string) { return Object.keys(await this.values()).filter((key) => key.startsWith(prefix)) }
  async write(values: Record<string, unknown>) { await call("EncryptedWrite", this.owner, JSON.stringify(values, (_key, value) => value === undefined ? null : value)) }
}
export function desktopEncryptedWorkspace(owner: string) {
  if (workspace?.owner === owner && !workspace.closed) return workspace
  workspace?.close()
  workspace = new EncryptedWorkspace(owner, new NativeCrypto(owner), new NativeStorage(owner), async <T>(path: string, body?: unknown) =>
    JSON.parse(await call<string>("EncryptedTransport", owner, path, body === undefined ? "" : JSON.stringify(body))) as T)
  return workspace
}
export function closeDesktopEncryptedWorkspace() { workspace?.close(); workspace = undefined }
