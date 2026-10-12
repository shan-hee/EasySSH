import { packSessions, unpackSessions } from "@/lib/secure-runtime/session-chunks"
import { Browser, Call } from "@wailsio/runtime"
import type { SyncAdapter, SyncStatus, SyncCandidate, SyncLogin, SyncScopes } from "@/lib/sync/types"
import type { SyncSnapshot } from "@/lib/sync/automerge"
import type { Scope } from "@/lib/secure-runtime/crypto"
import { desktopEncryptedWorkspace, closeDesktopEncryptedWorkspace } from "./desktop-encrypted"

type LocalState = { scopes: SyncScopes; grants: SyncScopes; server_url: string; space_id: string; account_name: string; enabled: boolean; last_sync: string; revision: number; snapshot: SyncSnapshot; hash: string }
type Projection = { snapshot: SyncSnapshot; hash: string }
const call = <T>(method: string, ...args: unknown[]): Promise<T> => Call.ByName('main.DesktopSyncService.' + method, ...args)
let active: Promise<void> | null = null
let lastError = ""
let changingAccount = false
export function isDesktopSyncRunning() { return active !== null }
function notifySyncStatus() { window.dispatchEvent(new Event("easyssh:sync-status-changed")) }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function applyLocalChanges(base: SyncSnapshot, current: SyncSnapshot, remote: SyncSnapshot): SyncSnapshot {
  const result = structuredClone(remote)
  for (const key of Object.keys(base)) if (!(key in current)) delete result[key]
  for (const [key, record] of Object.entries(current)) {
    if (equal(record, base[key])) continue
    if (!base[key] && result[key]) continue
    const next = { ...(result[key] || {}) }
    for (const field of Object.keys(base[key] || {})) if (!(field in record)) delete next[field]
    for (const [field, value] of Object.entries(record)) if (base[key]?.[field] !== value) next[field] = value
    result[key] = next
  }
  return result
}
async function synchronize() {
  const state = await call<LocalState>("Load")
  if (!state.enabled || !state.space_id) return
  const workspace = desktopEncryptedWorkspace(state.space_id)
  if (!workspace.ready) throw new Error("请先解锁并完成加密设备配对")
  const base = await workspace.projectionBaseline("config", "configuration")
  if (!equal(base, state.snapshot)) await workspace.edit("config", "configuration", (remote) => applyLocalChanges(base, state.snapshot, remote))
  await workspace.sync()
  const snapshot = await workspace.snapshot("config", "configuration")
  const conflicts = await workspace.conflicts("config", "configuration")
  if (conflicts.length) throw new Error("配置有并发冲突，请选择要保留的版本")
  if (!(await call<boolean>("Save", { revision: state.revision, hash: state.hash, snapshot }))) throw new Error("本地配置刚刚发生变化，请重试同步")
  await workspace.saveProjectionBaseline("config", "configuration", snapshot)
  for (const [scope, resource, projection] of [["credentials", "ssh-keys", "ssh_keys"], ["credentials", "credentials", "credentials"], ["ai_config", "ai_config", "ai_config"], ["sessions", "sessions", "sessions"]] as [Scope, string, string][]) {
    if (!state.scopes[scope as keyof SyncScopes] || !workspace.view?.scopes.includes(scope)) continue
    const local = await call<Projection>("EncryptedProjectionLoad", state.space_id, projection)
    const localSnapshot = scope === "sessions" ? await packSessions(workspace, local.snapshot) : structuredClone(local.snapshot)
    const previous = await workspace.projectionBaseline(scope, resource)
    if (projection === "credentials") {
      for (const key of Object.keys(previous)) {
        const serverKey = "server/" + key.slice(6)
        // Applying a remote connection change intentionally clears local secrets.
        // That is not a local request to delete the remote credential.
        if (!localSnapshot[key] && snapshot[serverKey] && state.snapshot[serverKey]?.connection !== snapshot[serverKey].connection) localSnapshot[key] = previous[key]
      }
    }
    if (!equal(previous, localSnapshot)) await workspace.edit(scope, resource, (remote) => applyLocalChanges(previous, localSnapshot, remote))
    await workspace.sync()
    if ((await workspace.conflicts(scope, resource)).length) throw new Error("加密数据存在并发冲突，请选择版本后继续")
    const projected = await workspace.snapshot(scope, resource)
    const applied = await call<Projection>("EncryptedProjectionApply", state.space_id, projection, local.hash, JSON.stringify(scope === "sessions" ? await unpackSessions(workspace, projected) : projected))
    await workspace.saveProjectionBaseline(scope, resource, scope === "sessions" ? await packSessions(workspace, applied.snapshot) : applied.snapshot)
  }
  const binding = await call<LocalState>("Load")
  if (binding.space_id !== state.space_id) throw new Error("同步账号已改变")
  await call("MarkSynced", binding.space_id, binding.revision)
  lastError = ""; window.dispatchEvent(new Event("easyssh:sync-applied"))
}
function syncNow(): Promise<void> {
  if (changingAccount) return Promise.resolve()
  if (!active) { active = synchronize().catch((error) => { lastError = error instanceof Error ? error.message : String(error); throw error }).finally(() => { active = null; notifySyncStatus() }); notifySyncStatus() }
  return active
}
export const desktopSyncAdapter: SyncAdapter = {
  async encryptedWorkspace() { const state = await call<LocalState>("Load"); return state.space_id ? desktopEncryptedWorkspace(state.space_id) : null },
  lockEncryptedWorkspace: closeDesktopEncryptedWorkspace,
  async status(): Promise<SyncStatus> {
    const state = await call<LocalState>("Load")
    const workspace = state.space_id ? desktopEncryptedWorkspace(state.space_id) : null
    const conflicts = workspace?.ready ? await workspace.conflicts("config", "configuration") : []
    return { connected: !!state.space_id, enabled: state.enabled, server_url: state.server_url, space_id: state.space_id, account_name: state.account_name,
      last_sync: state.last_sync, error: lastError, conflicts, scopes: state.scopes, grants: state.grants,
      records: Object.keys(state.snapshot).filter((key) => key.startsWith("server/") || key.startsWith("script/")).length }
  },
  sync: syncNow,
  async beginLogin(url, name) { const login = await call<SyncLogin>("BeginAuthorization", url, name); try { await Browser.OpenURL(login.url) } catch (e) { await call("CancelAuthorization"); throw e }; return login },
  async pollLogin() { const connected = await call<boolean>("PollAuthorization"); if (connected) { closeDesktopEncryptedWorkspace(); lastError = ""; notifySyncStatus() }; return connected },
  async cancelLogin() { await call("CancelAuthorization") },
  async candidates() { return [...await call<SyncCandidate[]>("Candidates"), ...await call<SyncCandidate[]>("SessionCandidates"), ...await call<SyncCandidate[]>("KeyCandidates")] },
  async enroll(spaceID, keys) {
    if (active) await active.catch(() => {})
    const records = keys.filter((key) => !key.startsWith("ai_session/") && !key.startsWith("ssh_key/")); if (records.length) await call("Enroll", spaceID, records)
    for (const key of keys.filter((key) => key.startsWith("ai_session/"))) await call("EnrollSession", spaceID, key.slice(11))
    for (const key of keys.filter((key) => key.startsWith("ssh_key/"))) await call("EnrollSSHKey", spaceID, key.slice(8))
    await syncNow()
  },
  async setScopes(scopes) { if (active) await active.catch(() => {}); await call("SetScopes", scopes); await syncNow() },
  async enrollAIConfig(spaceID) { if (active) await active.catch(() => {}); await call("EnrollAIConfig", spaceID); await syncNow() },
  async setEnabled(enabled) { await call("SetEnabled", enabled); notifySyncStatus(); if (enabled) await syncNow() },
  async disconnect() {
    changingAccount = true
    try { if (active) await active.catch(() => {}); closeDesktopEncryptedWorkspace(); const revoked = await call<boolean>("Disconnect"); lastError = ""; window.dispatchEvent(new Event("easyssh:sync-applied")); return revoked }
    finally { changingAccount = false }
  },
  async resolve(key, field, value) { if (active) await active.catch(() => {}); const state = await call<LocalState>("Load"); await desktopEncryptedWorkspace(state.space_id).resolve("config", "configuration", key, field, value); await syncNow() },
}
export function startDesktopSync(): () => void {
  const run = () => { void syncNow().catch(() => {}) }
  const timer = window.setInterval(run, 15000)
  window.addEventListener("online", run); window.addEventListener("focus", run); run()
  return () => { window.clearInterval(timer); window.removeEventListener("online", run); window.removeEventListener("focus", run); closeDesktopEncryptedWorkspace() }
}
