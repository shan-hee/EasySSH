import { useCallback, useLayoutEffect, useRef, useState } from "react"
import type { SshWorkspacePreferenceAdapter } from "@/lib/session/workspace"

export function useSftpTreeLayout(storageKey: string, preferences?: SshWorkspacePreferenceAdapter) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const panelRef = useCallback((node: HTMLDivElement | null) => { setPanel(node) }, [])
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(() => preferences?.getString(`${storageKey}:tree:visible`) === "true")
  const [width, setWidth] = useState(() => {
    const stored = Number(preferences?.getString(`${storageKey}:tree:width`))
    return Number.isFinite(stored) && stored >= 160 ? Math.min(420, stored) : 220
  })
  const [panelWidth, setPanelWidth] = useState(0)
  const narrow = panelWidth < 640
  const maxWidth = Math.min(420, Math.max(160, panelWidth * 0.5))
  const actualWidth = narrow ? Math.min(width, Math.max(0, panelWidth - 36)) : Math.min(width, maxWidth)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!panel) return
    const observer = new ResizeObserver(([entry]) => setPanelWidth(entry.contentRect.width))
    setPanelWidth(panel.clientWidth)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [panel])

  const persist = useCallback((key: string, value: string) => {
    void Promise.resolve(preferences?.setString(`${storageKey}:tree:${key}`, value)).catch(() => undefined)
  }, [preferences, storageKey])
  const toggle = useCallback(() => {
    setVisible(!visible)
    persist("visible", String(!visible))
  }, [persist, visible])
  const dismiss = useCallback(() => {
    setVisible(false)
    persist("visible", "false")
    toggleRef.current?.focus()
  }, [persist])
  const resize = useCallback((value: number) => {
    const next = Math.min(maxWidth, Math.max(160, value))
    setWidth(next)
    return next
  }, [maxWidth])

  return { panelRef, toggleRef, visible, toggle, dismiss, narrow, actualWidth, maxWidth, resizeStart, resize, persist }
}
