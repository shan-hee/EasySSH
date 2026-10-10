import { Browser, Call } from "@wailsio/runtime"
import type {
  SyncAdapter,
  SyncStatus,
  SyncCandidate,
  SyncLogin,
  SyncScopes,
  SyncConflict,
} from "@/lib/sync/types"
import type { SyncSnapshot, SyncPeer } from "@/lib/sync/automerge"

type LocalState = {
  scopes: SyncScopes
  grants: SyncScopes
  server_url: string
  space_id: string
  account_name: string
  enabled: boolean
  document: string
  remote_heads: string[]
  last_sync: string
  revision: number
  snapshot: SyncSnapshot
  hash: string
}
const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
  Call.ByName(`main.DesktopSyncService.${method}`, ...args)
let active: Promise<void> | null = null
let lastError = ""
let changingAccount = false

async function synchronizeConfiguration() {
  // Lazy loading keeps WASM off the startup path for users without sync.
  let state = await call<LocalState>("Load")
  if (!state.enabled || !state.space_id) return
  const engine = await import("@/lib/sync/automerge")
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) state = await call<LocalState>("Load")
    if (!state.enabled) return
    let doc = engine.loadDocument(state.document)
    try {
      doc = engine.reconcileDocument(doc, state.snapshot)
      const saved = await call<boolean>("Save", {
        ...state,
        document: engine.saveDocument(doc),
        snapshot: null,
      })
      if (!saved) continue
      const response = JSON.parse(
        await call<string>(
          "Exchange",
          JSON.stringify(engine.outgoing(doc, state.remote_heads)),
          state.revision + 1,
        ),
      ) as SyncPeer
      doc = engine.receive(doc, response)
      const projected = engine.projectDocument(doc)
      const applied = await call<boolean>("Save", {
        revision: state.revision + 1,
        hash: state.hash,
        document: engine.saveDocument(doc),
        remote_heads: response.heads,
        snapshot: projected.snapshot,
      })
      if (!applied) continue
      if (JSON.stringify(state.snapshot) !== JSON.stringify(projected.snapshot))
        window.dispatchEvent(new Event("easyssh:sync-applied"))
      return
    } finally {
      engine.freeDocument(doc)
    }
  }
  throw new Error("Local data changed during sync; the next attempt will retry")
}
type VaultEntry = { kind: string; id: string; name: string }
type VaultState = VaultEntry & {
  space_id: string
  document: string
  heads: string[]
  snapshot: SyncSnapshot
  revision: number
  binding_revision: number
}
const valueKey = "value/00000000-0000-4000-8000-000000000001"

async function synchronizeVault(entry: VaultEntry) {
  const engine = await import("@/lib/sync/automerge")
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await call<VaultState>("PrepareVault", entry.kind, entry.id)
    let doc = engine.loadDocument(state.document)
    try {
      doc = engine.reconcileDocument(doc, state.snapshot)
      if (
        !(await call<boolean>("SaveVault", {
          ...state,
          document: engine.saveDocument(doc),
          snapshot: null,
          conflicts: engine.projectDocument(doc).conflicts,
        }))
      )
        continue
      const response = JSON.parse(
        await call<string>(
          "ExchangeVault",
          entry.kind,
          entry.id,
          JSON.stringify(engine.outgoing(doc, state.heads)),
          state.space_id,
          state.binding_revision,
        ),
      ) as SyncPeer
      doc = engine.receive(doc, response)
      const projected = engine.projectDocument(doc)
      if (
        !(await call<boolean>("SaveVault", {
          ...state,
          revision: state.revision + 1,
          document: engine.saveDocument(doc),
          heads: response.heads,
          ...projected,
        }))
      )
        continue
      if (
        JSON.stringify(state.snapshot) !== JSON.stringify(projected.snapshot) &&
        !projected.conflicts.length
      )
        window.dispatchEvent(new Event("easyssh:sync-applied"))
      return
    } finally {
      engine.freeDocument(doc)
    }
  }
  throw new Error("Local data changed during sync; the next attempt will retry")
}
async function synchronize() {
  const initial = await call<LocalState>("Load")
  if (!initial.enabled || !initial.space_id) return
  await synchronizeConfiguration()
  const binding = await call<LocalState>("Load")
  if (!binding.enabled || binding.space_id !== initial.space_id)
    throw new Error("Sync account changed")
  const entries = await call<VaultEntry[]>("VaultList")
  const errors: string[] = []
  for (const entry of entries) {
    try {
      await synchronizeVault(entry)
    } catch (error) {
      errors.push(
        `${entry.name || entry.kind}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (errors.length) throw new Error(errors.join("\n"))
  await call("MarkSynced", binding.space_id, binding.revision)
  lastError = ""
}

function syncNow(): Promise<void> {
  if (changingAccount) return Promise.resolve()
  if (!active)
    active = synchronize()
      .catch((error) => {
        lastError = error instanceof Error ? error.message : String(error)
        throw error
      })
      .finally(() => {
        active = null
      })
  return active
}
export const desktopSyncAdapter: SyncAdapter = {
  async status(): Promise<SyncStatus> {
    const state = await call<LocalState>("Load")
    const engine = state.document ? await import("@/lib/sync/automerge") : null
    let conflicts: SyncStatus["conflicts"] = []
    if (engine) {
      const doc = engine.loadDocument(state.document)
      try {
        conflicts = engine.projectDocument(doc).conflicts
      } finally {
        engine.freeDocument(doc)
      }
    }
    return {
      connected: !!state.space_id,
      enabled: state.enabled,
      server_url: state.server_url,
      space_id: state.space_id,
      account_name: state.account_name,
      last_sync: state.last_sync,
      error: lastError,
      conflicts: [...conflicts, ...(await call<SyncConflict[]>("VaultConflicts"))],
      scopes: state.scopes,
      grants: state.grants,
      records: Object.keys(state.snapshot).length,
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
    await syncNow()
  },
  async setScopes(scopes) {
    if (active) await active.catch(() => {})
    await call("SetScopes", scopes)
    window.dispatchEvent(new Event("easyssh:sync-applied"))
    await syncNow()
  },
  async enrollAIConfig(spaceID) {
    if (active) await active.catch(() => {})
    await call("EnrollAIConfig", spaceID)
    window.dispatchEvent(new Event("easyssh:sync-applied"))
    await syncNow()
  },
  async forkSession(key, ref) {
    if (active) await active.catch(() => {})
    const state = await call<LocalState>("Load")
    await call("ForkVaultSession", state.space_id, key, ref)
    window.dispatchEvent(new Event("easyssh:sync-applied"))
    await syncNow()
  },
  async setEnabled(enabled) {
    await call("SetEnabled", enabled)
    if (enabled) await syncNow()
  },
  async disconnect() {
    changingAccount = true
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
  async resolve(key, field, value) {
    if (active) await active.catch(() => {})
    const engine = await import("@/lib/sync/automerge")
    if (key.startsWith("vault/")) {
      const [, kind, id] = key.split("/")
      const state = await call<VaultState>("PrepareVault", kind, id)
      let doc = engine.loadDocument(state.document)
      try {
        doc = engine.resolveConflict(
          engine.reconcileDocument(doc, state.snapshot),
          valueKey,
          "ref",
          value,
        )
        const saved = await call<boolean>("SaveVault", {
          ...state,
          document: engine.saveDocument(doc),
          ...engine.projectDocument(doc),
        })
        if (!saved) throw new Error("Local data changed; refresh and retry")
      } finally {
        engine.freeDocument(doc)
      }
      window.dispatchEvent(new Event("easyssh:sync-applied"))
      await syncNow()
      return
    }
    const state = await call<LocalState>("Load")
    let doc = engine.loadDocument(state.document)
    try {
      doc = engine.resolveConflict(engine.reconcileDocument(doc, state.snapshot), key, field, value)
      const saved = await call<boolean>("Save", {
        ...state,
        document: engine.saveDocument(doc),
        snapshot: engine.projectDocument(doc).snapshot,
      })
      if (!saved) throw new Error("Local data changed; refresh and retry")
      window.dispatchEvent(new Event("easyssh:sync-applied"))
    } finally {
      engine.freeDocument(doc)
    }
    await syncNow()
  },
}
export function startDesktopSync(): () => void {
  const run = () => {
    void syncNow().catch(() => {})
  }
  const timer = window.setInterval(run, 15000)
  window.addEventListener("online", run)
  window.addEventListener("focus", run)
  run()
  return () => {
    window.clearInterval(timer)
    window.removeEventListener("online", run)
    window.removeEventListener("focus", run)
  }
}
