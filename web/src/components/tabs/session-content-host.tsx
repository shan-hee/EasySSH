import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** A layout slot moves the portal container, never the React session tree. */
export function SessionContentSlot({ host }: { host: HTMLElement }) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const target = slot.current!
    target.appendChild(host)
    return () => { if (host.parentNode === target) host.remove() }
  }, [host])
  return <div ref={slot} className="flex h-full min-h-0 min-w-0 flex-1 flex-col" />
}

export function useSessionContentHosts(ids: string[]) {
  const [hosts] = useState(() => new Map<string, HTMLElement>())
  useEffect(() => {
    const live = new Set(ids)
    for (const [id, host] of hosts) if (!live.has(id)) { host.remove(); hosts.delete(id) }
  }, [hosts, ids])
  return useCallback((id: string) => {
    let host = hosts.get(id)
    if (!host) {
      host = document.createElement("div")
      host.className = "flex h-full min-h-0 min-w-0 flex-1 flex-col"
      hosts.set(id, host)
    }
    return host
  }, [hosts])
}

export function PersistentSessionContent({ host, children }: { host: HTMLElement; children: ReactNode }) {
  return createPortal(children, host)
}
