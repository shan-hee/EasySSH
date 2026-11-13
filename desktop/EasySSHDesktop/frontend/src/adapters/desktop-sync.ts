import { Browser, Events } from "@wailsio/runtime"
import * as DesktopSyncService from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopsyncservice"
import type {
  SyncAdapter,
  SyncStatus,
  SyncCandidate,
  SyncLogin,
  SyncScopes,
  SyncConflict,
  SyncChoice,
} from "@easyssh/app/lib/sync/types"

type LocalState = {
  scopes: SyncScopes
  grants: SyncScopes
  server_url: string
  space_id: string
  account_name: string
  enabled: boolean
  last_sync: string
  revision: number
  snapshot: Record<string, Record<string, string>>
  hash: string
  conflicts: SyncConflict[]
}
const call = <T>(method: keyof typeof DesktopSyncService, ...args: unknown[]): Promise<T> =>
  (DesktopSyncService[method] as unknown as (...input: unknown[]) => Promise<T>)(...args)
let active: Promise<void> | null = null
let lastError = ""
let changingAccount = false
let syncPending = false
let syncTimer: number | undefined
const authExpiredMessage = "设备授权已失效或被撤销，请重新登录同步"

function syncErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error)
  // The desktop bridge can encode its RuntimeError envelope in the message.
  try {
    const detail: unknown = JSON.parse(message)
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
      message = detail.message
    }
  } catch {
    // Plain error messages need no decoding.
  }
  if (message === "sync HTTP 409: sync_failed conversation is busy" || message === "sync HTTP 409: sync_failed ai session is busy") {
    return "服务端 AI 会话正在运行或等待确认，请在服务端处理该会话后重试同步"
  }
  if (message === "conversation is busy" || message === "AI is busy; retry after the current operation") {
    return "本地 AI 会话正在运行或等待确认，请处理该会话后重试同步"
  }
  // The server rejects revoked or expired device tokens; retrying cannot help.
  if (message.startsWith("sync HTTP 401:")) return authExpiredMessage
  return message
}

// Coalesce successful local edits without making local saves wait for the network.
export function requestDesktopSync() {
  if (changingAccount) return
  syncPending = true
  window.clearTimeout(syncTimer)
  if (active) return
  syncTimer = window.setTimeout(() => {
    void syncNow().catch(() => {})
  }, 500)
}

export function isDesktopSyncRunning() {
  return active !== null
}

function notifySyncStatus() {
  window.dispatchEvent(new Event("easyssh:sync-status-changed"))
}

// One round runs entirely in the desktop backend, which owns both the data and
// the merge. It reports whether local records were replaced.
async function synchronizeConfiguration() {
  const result = await call<{ changed: boolean; servers_changed: boolean }>("SynchronizeConfiguration")
  return { changed: result.changed, serversChanged: result.servers_changed }
}
type VaultEntry = { kind: string; id: string; name: string }

function synchronizeVault(entry: VaultEntry) {
  return call<boolean>("SynchronizeVault", entry.kind, entry.id)
}
function resolveChoices(choices: SyncChoice[]) {
  return call<void>("ResolveConflicts", choices)
}

// identicalValues are the versions that were compared as equal; the backend
// only resolves automatically while they are still the candidates.
function resolveVaultChoice(choice: SyncChoice, identicalValues?: string[]) {
  return call<void>("ResolveVault", choice.key, choice.value, identicalValues ?? null)
}

async function synchronize() {
  const initial = await call<LocalState>("Load")
  if (!initial.enabled || !initial.space_id) return
  const changes = await synchronizeConfiguration()
  try {
    const binding = await call<LocalState>("Load")
    if (!binding.enabled || binding.space_id !== initial.space_id)
      throw new Error("Sync account changed")
    const entries = await call<VaultEntry[]>("VaultList")
    const errors: string[] = []
    for (const entry of entries) {
      try {
        if (await synchronizeVault(entry)) {
          changes.changed = true
          if (entry.kind === "credential") changes.serversChanged = true
        }
      } catch (error) {
        const message = syncErrorMessage(error)
        if (message === authExpiredMessage) throw new Error(message)
        errors.push(
          `${entry.kind === "ai_session" ? `AI 会话「${entry.name || entry.id}」` : entry.name || entry.kind}: ${message}`,
        )
      }
    }
    if (errors.length) throw new Error(errors.join("\n"))
    // Versions with the same content (e.g. both sides re-encrypted the same
    // credential after a re-login) need no user decision; keep the server copy.
    const identical = (await call<SyncConflict[]>("VaultConflicts")).filter((conflict) => conflict.identical)
    for (const conflict of identical) {
      await resolveVaultChoice({
        key: conflict.key,
        field: conflict.field,
        value: conflict.values.find((value) => conflict.previews?.[value]?.source === "server") ?? conflict.values[0],
      }, conflict.values)
      // A record first received with such a conflict is only applied now.
      changes.changed = true
      if (conflict.key.startsWith("vault/credential/")) changes.serversChanged = true
      // The next round uploads the resolution.
      syncPending = true
    }
    await call("MarkSynced", binding.space_id, binding.revision)
    lastError = ""
  } finally {
    // Publish once after configuration and credentials are available, including
    // successful changes when another vault entry fails later in this round.
    if (changes.changed) window.dispatchEvent(new CustomEvent("easyssh:sync-applied", {
      detail: { serversChanged: changes.serversChanged },
    }))
  }
}

function syncNow(): Promise<void> {
  if (changingAccount) return Promise.resolve()
  if (!active) {
    window.clearTimeout(syncTimer)
    syncTimer = undefined
    syncPending = false
    active = synchronize()
      .catch((error) => {
        lastError = syncErrorMessage(error)
        throw new Error(lastError)
      })
      .finally(() => {
        active = null
        notifySyncStatus()
        // An edit made during the exchange must get its own round.
        if (syncPending) requestDesktopSync()
      })
    notifySyncStatus()
  }
  return active
}
export const desktopSyncAdapter: SyncAdapter = {
  async status(): Promise<SyncStatus> {
    const state = await call<LocalState>("Load")
    return {
      connected: !!state.space_id,
      enabled: state.enabled,
      syncing: isDesktopSyncRunning(),
      server_url: state.server_url,
      space_id: state.space_id,
      account_name: state.account_name,
      last_sync: state.last_sync,
      error: lastError,
      auth_expired: lastError === authExpiredMessage,
      conflicts: [...state.conflicts, ...(await call<SyncConflict[]>("VaultConflicts"))],
      scopes: state.scopes,
      grants: state.grants,
      records: Object.keys(state.snapshot).filter((key) => key.startsWith("server/") || key.startsWith("script/")).length,
    }
  },
  sync: syncNow,
  async beginLogin(url, name) {
    const login = await call<SyncLogin>("BeginAuthorization", url, name)
    try {
      await Browser.OpenURL(login.url)
    } catch (error) {
      await call("CancelAuthorization")
      throw error
    }
    return login
  },
  async pollLogin() {
    const connected = await call<boolean>("PollAuthorization")
    if (connected) {
      lastError = ""
      window.dispatchEvent(new Event("easyssh:sync-applied"))
    }
    return connected
  },
  async cancelLogin() {
    await call("CancelAuthorization")
  },
  async candidates() {
    const [records, sessions] = await Promise.all([
      call<SyncCandidate[]>("Candidates"),
      call<SyncCandidate[]>("SessionCandidates"),
    ])
    return [...records, ...sessions]
  },
  async enroll(spaceID, keys) {
    if (active) await active.catch(() => {})
    const records = keys.filter((key) => !key.startsWith("ai_session/"))
    if (records.length) await call("Enroll", spaceID, records)
    for (const key of keys.filter((key) => key.startsWith("ai_session/")))
      await call("EnrollSession", spaceID, key.slice("ai_session/".length))
    window.dispatchEvent(new Event("easyssh:sync-applied"))
    requestDesktopSync()
  },
  async setScopes(scopes) {
    if (active) await active.catch(() => {})
    await call("SetScopes", scopes)
    lastError = ""
    window.dispatchEvent(new Event("easyssh:sync-applied"))
    notifySyncStatus()
    requestDesktopSync()
  },
  async enrollAIConfig(spaceID) {
    if (active) await active.catch(() => {})
    await call("EnrollAIConfig", spaceID)
    window.dispatchEvent(new Event("easyssh:sync-applied"))
    requestDesktopSync()
  },
  async forkSession(key, ref) {
    if (active) await active.catch(() => {})
    const state = await call<LocalState>("Load")
    await call("ForkVaultSession", state.space_id, key, ref)
    window.dispatchEvent(new Event("easyssh:sync-applied"))
    requestDesktopSync()
  },
  async setEnabled(enabled) {
    if (active) await active.catch(() => {})
    await call("SetEnabled", enabled)
    lastError = ""
    if (!enabled) {
      window.clearTimeout(syncTimer)
      syncTimer = undefined
      syncPending = false
    }
    notifySyncStatus()
    if (enabled) requestDesktopSync()
  },
  async disconnect() {
    changingAccount = true
    window.clearTimeout(syncTimer)
    syncPending = false
    try {
      if (active) await active.catch(() => {})
      const revoked = await call<boolean>("Disconnect")
      lastError = ""
      window.dispatchEvent(new Event("easyssh:sync-applied"))
      return revoked
    } finally {
      changingAccount = false
    }
  },
  async resolve(choices) {
    if (active) await active.catch(() => {})
    try {
      await resolveChoices(choices)
    } finally {
      // Choices saved before a failure still need publishing and uploading.
      window.dispatchEvent(new Event("easyssh:sync-applied"))
      requestDesktopSync()
    }
  },
}
export function startDesktopSync(): () => void {
  // Persisted session snapshots signal completed edits/turns; streaming deltas
  // and running snapshots must not trigger a sync on every token or tool call.
  const unsubscribe = Events.On("easyssh:desktop-ai:session-event", (event) => {
    const data = event.data as { type?: string; session?: { status?: string } } | undefined
    if (data?.type === "session" && (data.session?.status === "idle" || data.session?.status === "closed")) {
      requestDesktopSync()
    }
  })
  window.addEventListener("online", requestDesktopSync)
  requestDesktopSync()
  return () => {
    window.clearTimeout(syncTimer)
    syncPending = false
    window.removeEventListener("online", requestDesktopSync)
    unsubscribe()
  }
}
