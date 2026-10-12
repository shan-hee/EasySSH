import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useTerminalStore } from "@/stores/terminal-store"
import { closeWorkspace, openWorkspace } from "@/lib/secure-runtime/session"
import type { EncryptedWorkspace } from "@/lib/secure-runtime/workspace"
import { EncryptedWorkspacePanel } from "@/components/settings/encrypted-workspace-panel"

const Context = createContext<{ workspace: EncryptedWorkspace; lock(): void } | null>(null)
export function useEncryptedWorkspace() { return useContext(Context) }

export function EncryptedWorkspaceProvider({ owner, children }: { owner: string; children: ReactNode }) {
  const [workspace, setWorkspace] = useState<EncryptedWorkspace>()
  const [generation, setGeneration] = useState(0)
  const [, render] = useState(0)
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  useEffect(() => {
    const instance = openWorkspace(owner)
    setWorkspace(instance)
    const unsubscribe = instance.subscribe(() => {
      if (instance.closed) { setWorkspace(undefined); setGeneration((value) => value + 1) }
      else render((value) => value + 1)
    })
    const pagehide = () => closeWorkspace(instance)
    const clear = () => { queryClient.clear(); useTerminalStore.getState().resetAll() }
    window.addEventListener("easyssh:workspace-locked", clear)
    window.addEventListener("pagehide", pagehide)
    const timer = window.setInterval(() => {
      if (instance.view?.manifest.revision) void instance.sync().catch(() => {})
    }, 60000)
    return () => { unsubscribe(); clearInterval(timer); window.removeEventListener("pagehide", pagehide); closeWorkspace(instance); window.removeEventListener("easyssh:workspace-locked", clear) }
  }, [owner, generation, queryClient])
  if (!workspace || workspace.owner !== owner) return null
  const lock = () => { closeWorkspace(workspace); setWorkspace(undefined); setGeneration((value) => value + 1) }
  // Account and deployment settings remain available without business keys.
  const settings = pathname === "/dashboard/settings" || pathname.startsWith("/dashboard/settings/")
  return <Context.Provider value={{ workspace, lock }}>
    {workspace.ready || settings ? children : <EncryptedWorkspacePanel workspace={workspace} onLock={lock} />}
  </Context.Provider>
}
