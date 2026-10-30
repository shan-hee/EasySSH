import { authenticatedFetch, getApiUrl } from "@/lib/api-client"
import type { SyncAdapter, SyncStatus } from "./types"
export async function syncRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(getApiUrl(`/sync${path}`), {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || body.error || `HTTP ${response.status}`)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
export const webSyncAdapter: SyncAdapter = {
  async status() {
    const result = await syncRequest<SyncStatus>("/status")
    return { ...result, connected: true, conflicts: result.conflicts || [] }
  },
  async setEnabled(enabled) {
    await syncRequest("/settings", { method: "PUT", body: JSON.stringify({ enabled }) })
  },
  async sync() {
    await syncRequest("/status")
  },
  async revokeDevice(id) {
    await syncRequest(`/devices/${encodeURIComponent(id)}`, { method: "DELETE" })
  },
  async forkSession(key, ref) {
    await syncRequest("/vault/fork", {
      method: "POST",
      body: JSON.stringify({ id: key.split("/")[2], ref }),
    })
    window.dispatchEvent(new Event("easyssh:sync-applied"))
  },
  async resolve(key, field, value) {
    await syncRequest("/resolve", { method: "POST", body: JSON.stringify({ key, field, value }) })
    window.dispatchEvent(new Event("easyssh:sync-applied"))
  },
}
