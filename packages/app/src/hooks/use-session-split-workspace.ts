import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react"
import { AdvancedDnDModule, createDockview, registerModules, type DockviewApi, type SerializedDockview } from "dockview"
import type { TerminalSession } from "@/components/terminal/types"
import type { SessionTabDragEvent, SessionTabDropSide } from "@/components/tabs/session-tab-bar"
import { getSplitPaneDragSessionId, hasSplitPaneDragSession, setSplitPaneDragSessionId } from "@/lib/session/split-pane-drag"

registerModules([AdvancedDnDModule])

type LayoutUpdater = SerializedDockview | null | ((current: SerializedDockview | null) => SerializedDockview | null)
interface Options {
  sessions: TerminalSession[]
  workspaceSessions: TerminalSession[]
  activeSessionId: string
  splitLayout: SerializedDockview | null
  setSplitLayout: (updater: LayoutUpdater) => void
  workspaceTab: { id: string; label: string }
  isActiveConfigSession: boolean
  isDisabled?: boolean
  setActiveSessionId: (id: string) => void
  onWorkspaceSessionActivated?: (id: string) => void
  onWorkspaceExited?: () => void
  buildTabSessions?: (params: { hasWorkspace: boolean; workspaceTabSession: TerminalSession; workspaceSessionIds: string[]; sessions: TerminalSession[] }) => TerminalSession[]
}

export interface SessionDockviewController {
  element: HTMLDivElement
  api: DockviewApi | null
  contents: Map<string, HTMLElement>
  tabs: Map<string, HTMLElement>
  actions: Map<string, HTMLElement>
}
const getDropSideFromRect = (event: SessionTabDragEvent, rect: DOMRect): SessionTabDropSide => {
  const distances: Array<[SessionTabDropSide, number]> = [["left", event.clientX - rect.left], ["right", rect.right - event.clientX], ["top", event.clientY - rect.top], ["bottom", rect.bottom - event.clientY]]
  return distances.reduce((best, item) => item[1] < best[1] ? item : best)[0]
}

/** Dockview owns the layout. React stores only its serialized snapshot and application session state. */
export function useSessionSplitWorkspace(options: Options) {
  const { sessions, workspaceSessions, activeSessionId, splitLayout, workspaceTab, isActiveConfigSession } = options
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  const [dockview] = useState<SessionDockviewController>(() => ({ element: document.createElement("div"), api: null, contents: new Map(), tabs: new Map(), actions: new Map() }))
  const [, setRendererVersion] = useState(0)
  const [visibleDockIds, setVisibleDockIds] = useState<string[]>([])
  const [tabDropSide, setTabDropSide] = useState<SessionTabDropSide | null>(null)
  const [tabDropTargetId, setTabDropTargetId] = useState<string | null>(null)
  const workspaceDropRef = useRef<HTMLDivElement>(null)
  const mutating = useRef(false)
  const disposed = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detachedSessionIds = useMemo(() => Object.keys(splitLayout?.panels ?? {}), [splitLayout])
  const workspaceSessionIdSet = useMemo(() => new Set(workspaceSessions.map(s => s.id)), [workspaceSessions])
  const splitWorkspaceSessionIds = useMemo(() => detachedSessionIds.filter(id => workspaceSessionIdSet.has(id)), [detachedSessionIds, workspaceSessionIdSet])
  const splitWorkspaceSessionIdSet = useMemo(() => new Set(splitWorkspaceSessionIds), [splitWorkspaceSessionIds])
  const hasWorkspace = splitWorkspaceSessionIds.length > 1
  const isWorkspaceActive = hasWorkspace && splitWorkspaceSessionIdSet.has(activeSessionId)
  const activeWorkspaceSession = workspaceSessions.find(s => s.id === activeSessionId) ?? null
  const singleVisibleSessionId = activeWorkspaceSession?.id
  const visibleSessionIds = useMemo(() => isActiveConfigSession ? [] : isWorkspaceActive ? visibleDockIds : singleVisibleSessionId ? [singleVisibleSessionId] : [], [isActiveConfigSession, isWorkspaceActive, visibleDockIds, singleVisibleSessionId])
  const visibleSessionIdSet = useMemo(() => new Set(visibleSessionIds), [visibleSessionIds])
  const isMultiSessionGrid = isWorkspaceActive

  const publish = useCallback(() => {
    const api = dockview.api
    if (!api || disposed.current || mutating.current) return
    // One remaining member is an ordinary tab; Dockview releases only its layout slots.
    if (api.panels.length === 1) {
      mutating.current = true
      api.clear()
      mutating.current = false
    }
    for (const group of api.groups) {
      group.element.dataset.workspacePaneSessionId = group.activePanel?.id ?? ""
    }
    setRendererVersion(version => version + 1)
    const next = api.panels.length > 1 ? api.toJSON() : null
    const visible = api.panels.filter(panel => panel.api.isVisible).map(panel => panel.id)
    setVisibleDockIds(current => current.join("\0") === visible.join("\0") ? current : visible)
    if (JSON.stringify(next) !== JSON.stringify(latest.current.splitLayout)) latest.current.setSplitLayout(next)
  }, [dockview])
  const mutate = useCallback((action: (api: DockviewApi) => void) => {
    const api = dockview.api
    if (!api) return
    mutating.current = true
    try { action(api) } finally { mutating.current = false; publish() }
  }, [dockview, publish])

  useLayoutEffect(() => {
    disposed.current = false
    dockview.element.className = "h-full min-h-0 min-w-0 w-full"
    const renderer = (map: Map<string, HTMLElement>, id: string) => {
      const element = document.createElement("div")
      element.className = "flex h-full min-h-0 min-w-0 flex-1 flex-col"
      map.set(id, element)
      return { element, init() {}, dispose() { if (map.get(id) === element) map.delete(id) } }
    }
    const api = createDockview(dockview.element, {
      theme: { name: "easyssh", className: "easyssh-dockview", gap: 8, dndPanelOverlay: "group" },
      disableFloatingGroups: true,
      defaultTabComponent: "session",
      createComponent: ({ id }) => renderer(dockview.contents, id),
      createTabComponent: ({ id }) => renderer(dockview.tabs, id),
      createRightHeaderActionComponent: group => renderer(dockview.actions, group.id),
    })
    dockview.api = api
    const bounds = dockview.element.getBoundingClientRect()
    api.layout(bounds.width, bounds.height)
    if (latest.current.splitLayout) api.fromJSON(latest.current.splitLayout)
    const listeners = [
      api.onDidLayoutChange(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(publish, 120)
      }),
      api.onDidMutateLayout(() => { if (!mutating.current) queueMicrotask(publish) }),
      api.onDidActivePanelChange(({ panel, origin }) => {
        if (mutating.current || disposed.current) return
        if (panel && origin === "user") {
          latest.current.setActiveSessionId(panel.id)
          latest.current.onWorkspaceSessionActivated?.(panel.id)
        }
        queueMicrotask(publish)
      }),
      api.onWillDragPanel(({ panel, nativeEvent }) => {
        if (latest.current.isDisabled) { nativeEvent.preventDefault(); return }
        if (nativeEvent instanceof DragEvent && nativeEvent.dataTransfer) setSplitPaneDragSessionId(nativeEvent.dataTransfer, panel.id)
      }),
      api.onWillDragGroup(({ group, nativeEvent }) => {
        if (latest.current.isDisabled) { nativeEvent.preventDefault(); return }
        if (group.panels.length === 1 && nativeEvent instanceof DragEvent && nativeEvent.dataTransfer) setSplitPaneDragSessionId(nativeEvent.dataTransfer, group.panels[0].id)
      }),
      // File drops belong to the SFTP transfer layer, never to the docking engine.
      api.onWillShowOverlay(event => { if (!event.getData()) event.preventDefault() }),
    ]
    publish()
    return () => {
      disposed.current = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      listeners.forEach(listener => listener.dispose())
      api.dispose()
      dockview.api = null
      dockview.contents.clear()
      dockview.tabs.clear()
      dockview.actions.clear()
    }
  }, [dockview, publish])

  useEffect(() => { dockview.api?.updateOptions({ disableDnd: !!options.isDisabled }) }, [dockview, options.isDisabled])

  useEffect(() => {
    for (const session of workspaceSessions) {
      const panel = dockview.api?.getPanel(session.id)
      if (panel && panel.title !== session.serverName) panel.api.setTitle(session.serverName)
    }
  }, [dockview, workspaceSessions])
  useEffect(() => {
    if (isWorkspaceActive) dockview.api?.getPanel(activeSessionId)?.api.setActive()
  }, [activeSessionId, dockview, isWorkspaceActive])

  const clearDropTarget = useCallback(() => { setTabDropSide(null); setTabDropTargetId(null) }, [])
  const activate = useCallback((id: string) => {
    latest.current.setActiveSessionId(id)
    latest.current.onWorkspaceSessionActivated?.(id)
  }, [])
  const merge = useCallback((source: string, target: string, side: SessionTabDropSide) => {
    const valid = new Map(latest.current.workspaceSessions.map(session => [session.id, session]))
    if (source === target || !valid.has(source) || !valid.has(target) || latest.current.isDisabled) return false
    mutate(api => {
      if (!api.getPanel(target)) api.addPanel({ id: target, component: "session", title: valid.get(target)!.serverName, renderer: "always", minimumWidth: 160, minimumHeight: 100 })
      const existing = api.getPanel(source)
      if (existing) existing.api.moveTo({ group: api.getPanel(target)!.group, position: side })
      else api.addPanel({ id: source, component: "session", title: valid.get(source)!.serverName, renderer: "always", minimumWidth: 160, minimumHeight: 100, position: { referencePanel: target, direction: side === "top" ? "above" : side === "bottom" ? "below" : side } })
    })
    activate(source)
    return true
  }, [activate, mutate])
  const getTabDropTarget = useCallback((event: SessionTabDragEvent) => {
    const workspaceElement = workspaceDropRef.current
    const workspaceRect = workspaceElement?.getBoundingClientRect()
    if (!workspaceElement || !workspaceRect) return null
    if (event.clientX < workspaceRect.left || event.clientX > workspaceRect.right) return null
    if (event.clientY < workspaceRect.top || event.clientY > workspaceRect.bottom) return null

    const paneElements = Array.from(
      workspaceElement.querySelectorAll<HTMLElement>("[data-workspace-pane-session-id], [data-split-session-id]")
    )
    const paneElement = paneElements.find((element) => {
      const targetSessionId = element.dataset.workspacePaneSessionId ?? element.dataset.splitSessionId ?? null
      if (!targetSessionId || targetSessionId === event.sessionId) return false
      if (element.closest('[aria-hidden="true"]')) return false

      const rect = element.getBoundingClientRect()
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      )
    })

    if (paneElement) {
      const rect = paneElement.getBoundingClientRect()
      const targetSessionId = paneElement.dataset.workspacePaneSessionId ?? paneElement.dataset.splitSessionId ?? null
      if (!targetSessionId) {
        return null
      }

      return {
        side: getDropSideFromRect(event, rect),
        targetSessionId,
      }
    }

    if (paneElements.length > 0) {
      return null
    }

    const fallbackTargetId = activeWorkspaceSession?.id ?? workspaceSessions[0]?.id ?? null

    return {
      side: getDropSideFromRect(event, workspaceRect),
      targetSessionId: fallbackTargetId && fallbackTargetId !== event.sessionId
        ? fallbackTargetId
        : workspaceSessions.find((session) => session.id !== event.sessionId)?.id ?? null,
    }
  }, [activeWorkspaceSession, workspaceSessions])

  const handleTabDragMove = useCallback((event: SessionTabDragEvent) => {
    const target = getTabDropTarget(event)
    setTabDropSide(target?.side ?? null)
    setTabDropTargetId(target?.targetSessionId ?? null)
  }, [getTabDropTarget])
  const handleTabDragEnd = useCallback((event: SessionTabDragEvent) => {
    clearDropTarget()
    const target = getTabDropTarget(event)
    return target?.targetSessionId ? merge(event.sessionId, target.targetSessionId, target.side) : false
  }, [clearDropTarget, getTabDropTarget, merge])
  const handleRestoreDetachedSession = useCallback((id: string) => {
    mutate(api => { const panel = api.getPanel(id); if (panel) api.removePanel(panel) })
    activate(id)
    clearDropTarget()
  }, [activate, clearDropTarget, mutate])
  const handleDetachSession = useCallback((id: string) => {
    const target = latest.current.activeSessionId !== id ? latest.current.activeSessionId : latest.current.workspaceSessions.find(session => session.id !== id)?.id
    if (target) merge(id, target, "right")
  }, [merge])
  const handleSplitPaneDropToTab = useCallback((source: string, target: string, side: SessionTabDropSide) => merge(target, source, side), [merge])
  const syncSplitLayout = useCallback((valid: Set<string>) => {
    const api = dockview.api
    if (api?.panels.some(panel => !valid.has(panel.id))) mutate(api => {
      for (const panel of [...api.panels]) if (!valid.has(panel.id)) api.removePanel(panel)
    })
  }, [dockview, mutate])
  const removeSessionFromWorkspace = useCallback((id: string) => {
    mutate(api => { const panel = api.getPanel(id); if (panel) api.removePanel(panel) })
  }, [mutate])
  const setSplitLayout = useCallback((update: LayoutUpdater) => {
    const value = typeof update === "function" ? update(latest.current.splitLayout) : update
    mutate(api => { if (value) api.fromJSON(value); else api.clear() })
  }, [mutate])
  const handleChangeActiveSession = useCallback((id: string) => {
    if (id === workspaceTab.id) {
      const next = dockview.api?.activePanel?.id
      if (next) activate(next)
    } else {
      latest.current.setActiveSessionId(id)
      if (!dockview.api?.getPanel(id)) latest.current.onWorkspaceExited?.()
    }
  }, [activate, dockview, workspaceTab.id])
  // Bridge native Dockview headers back to ordinary application tabs only.
  const nativeEvent = useCallback((event: ReactDragEvent<HTMLElement>): SessionTabDragEvent | null => {
    if (isWorkspaceActive || !hasSplitPaneDragSession(event.dataTransfer)) return null
    const id = getSplitPaneDragSessionId(event.dataTransfer)
    const session = latest.current.workspaceSessions.find(session => session.id === id)
    return session ? { session, sessionId: session.id, clientX: event.clientX, clientY: event.clientY, deltaX: 0, deltaY: 0, isOverTabBar: false } : null
  }, [isWorkspaceActive])
  const handleWorkspaceNativeDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const drag = nativeEvent(event)
    if (drag) { event.preventDefault(); handleTabDragMove(drag) }
  }, [handleTabDragMove, nativeEvent])
  const handleWorkspaceNativeDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const drag = nativeEvent(event)
    if (drag) { event.preventDefault(); event.stopPropagation(); handleTabDragEnd(drag) }
  }, [handleTabDragEnd, nativeEvent])
  const workspaceTabSession: TerminalSession = { id: workspaceTab.id, serverName: workspaceTab.label, host: "", username: "", shouldConnect: false, connectionPhase: "idle", status: "connected", lastActivity: 0, type: "terminal", pinned: false }
  const tabSessions = options.buildTabSessions?.({ hasWorkspace, workspaceTabSession, workspaceSessionIds: splitWorkspaceSessionIds, sessions }) ?? (hasWorkspace ? [workspaceTabSession, ...sessions.filter(session => !splitWorkspaceSessionIdSet.has(session.id))] : sessions)
  return {
    dockview, splitLayout, setSplitLayout, tabDropSide, tabDropTargetId, workspaceDropRef,
    detachedSessionIds, workspaceSessionIds: splitWorkspaceSessionIds, workspaceSessionIdSet: splitWorkspaceSessionIdSet,
    hasWorkspace, isWorkspaceActive, visibleSessionIds, visibleSessionIdSet, isMultiSessionGrid, workspaceTabSession, tabSessions,
    tabActiveId: isWorkspaceActive ? workspaceTab.id : activeSessionId,
    handleChangeActiveSession, handleDetachSession, handleTabDragStart: clearDropTarget, handleTabDragMove, handleTabDragEnd,
    handleTabDragCancel: clearDropTarget, handleSplitPaneDropToTab, handleRestoreDetachedSession,
    handleWorkspaceNativeDragOver, handleWorkspaceNativeDrop, handleWorkspaceNativeDragLeave: clearDropTarget,
    syncSplitLayout, removeSessionFromWorkspace, filterWorkspaceSessions: syncSplitLayout,
  }
}
