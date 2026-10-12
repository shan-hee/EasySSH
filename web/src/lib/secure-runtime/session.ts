import { apiFetch } from "@/lib/api-client"
import { BrowserCrypto } from "./crypto"
import { BrowserSecureStorage } from "./storage"
import { EncryptedWorkspace } from "./workspace"

let active: EncryptedWorkspace | undefined
export function currentWorkspace(): EncryptedWorkspace {
  if (!active) throw new Error("请先打开并解锁加密工作区")
  return active
}
export function openWorkspace(owner: string) {
  if (active?.owner === owner && !active.closed) return active
  active?.close()
  active = new EncryptedWorkspace(owner, new BrowserCrypto(), new BrowserSecureStorage(owner),
    <T>(path: string, body?: unknown) => apiFetch<T>(`/sync${path}`, body === undefined ? undefined : { method: "POST", body }))
  return active
}
export function closeWorkspace(workspace: EncryptedWorkspace) {
  workspace.close()
  if (active === workspace) active = undefined
}
