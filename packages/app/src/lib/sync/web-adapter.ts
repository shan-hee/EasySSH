import type { components } from "@/generated/openapi"
import { authenticatedFetch, getApiUrl } from "@/lib/api-client"
import { SyncResolutionError, type SyncAdapter, type SyncAffectedGrant, type SyncStatus } from "./types"
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
  async updateDeviceScopes(id, scopes) {
    await syncRequest(`/devices/${encodeURIComponent(id)}/scopes`, { method: "PUT", body: JSON.stringify(scopes) })
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
  async resolve(choices) {
    const affected: SyncAffectedGrant[] = []
    try {
      for (const choice of choices) {
        const result = await syncRequest<components["schemas"]["SyncExchangeResult"]>("/resolve", { method: "POST", body: JSON.stringify(choice) })
        affected.push(...result.affected_grants)
      }
    } catch (error) {
      // Earlier requests may already have invalidated shared connections.
      throw new SyncResolutionError(error instanceof Error ? error.message : String(error), affected)
    } finally {
      window.dispatchEvent(new Event("easyssh:sync-applied"))
    }
    return affected
  },
}
