import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react"
import type { TerminalSession } from "@/components/terminal/types"
import type {
  SessionTabDragEvent,
  SessionTabDropSide,
} from "@/components/tabs/session-tab-bar"
import {
  addSessionToSplitLayout,
  ensureMultiSessionLayout,
  filterSplitLayout,
  getSplitLayoutSessionIds,
  removeSessionFromSplitLayout,
  updateSplitLayoutSizes,
  type SessionSplitLayoutNode,
} from "@/lib/session/split-layout"
import {
  getSplitPaneDragSessionId,
  hasSplitPaneDragSession,
} from "@/lib/session/split-pane-drag"

type SplitLayoutUpdater =
  | SessionSplitLayoutNode
  | null
  | ((current: SessionSplitLayoutNode | null) => SessionSplitLayoutNode | null)

interface WorkspaceTabSessionOptions {
  id: string
  label: string
}

interface UseSessionSplitWorkspaceOptions {
  sessions: TerminalSession[]
  workspaceSessions: TerminalSession[]
  activeSessionId: string
  splitLayout?: SessionSplitLayoutNode | null
  setSplitLayout?: (updater: SplitLayoutUpdater) => void
  workspaceTab: WorkspaceTabSessionOptions
  isActiveConfigSession: boolean
  isDisabled?: boolean
  setActiveSessionId: (sessionId: string) => void
  onWorkspaceSessionActivated?: (sessionId: string) => void
  onSessionDroppedToWorkspace?: (sessionId: string) => void
  onWorkspaceExited?: () => void
  buildTabSessions?: (params: {
    hasWorkspace: boolean
    workspaceTabSession: TerminalSession
    workspaceSessionIds: string[]
    sessions: TerminalSession[]
  }) => TerminalSession[]
  getSingleVisibleSessionId?: (params: {
    activeSessionId: string
    activeWorkspaceSession: TerminalSession | null
    workspaceSessions: TerminalSession[]
  }) => string | null
  getDetachTargetSessionId?: (params: {
    activeSessionId: string
    activeWorkspaceSession: TerminalSession | null
    workspaceSessions: TerminalSession[]
  }) => string | null
  getDropFallbackSessionIds?: (params: {
    activeSessionId: string
    activeWorkspaceSession: TerminalSession | null
    workspaceSessions: TerminalSession[]
  }) => string[]
}

const getDropSideFromRect = (event: SessionTabDragEvent, rect: DOMRect): SessionTabDropSide => {
  const distances: Array<[SessionTabDropSide, number]> = [
    ["left", event.clientX - rect.left],
    ["right", rect.right - event.clientX],
    ["top", event.clientY - rect.top],
    ["bottom", rect.bottom - event.clientY],
  ]

  return distances.reduce((best, item) => (item[1] < best[1] ? item : best))[0]
}

const createWorkspaceTabSession = ({ id, label }: WorkspaceTabSessionOptions): TerminalSession => ({
  id,
  serverName: label,
  host: "",
  username: "",
  shouldConnect: false,
  connectionPhase: "idle",
  status: "connected",
  lastActivity: 0,
  type: "terminal",
  pinned: false,
})

export function useSessionSplitWorkspace({
  sessions,
  workspaceSessions,
  activeSessionId,
  splitLayout: controlledSplitLayout,
  setSplitLayout: setControlledSplitLayout,
  workspaceTab,
  isActiveConfigSession,
  isDisabled = false,
  setActiveSessionId,
  onWorkspaceSessionActivated,
  onSessionDroppedToWorkspace,
  onWorkspaceExited,
  buildTabSessions,
  getSingleVisibleSessionId,
  getDetachTargetSessionId,
  getDropFallbackSessionIds,
}: UseSessionSplitWorkspaceOptions) {
  const { id: workspaceTabId, label: workspaceTabLabel } = workspaceTab
  const [internalSplitLayout, setInternalSplitLayout] = useState<SessionSplitLayoutNode | null>(null)
  const [tabDropSide, setTabDropSide] = useState<SessionTabDropSide | null>(null)
  const [tabDropTargetId, setTabDropTargetId] = useState<string | null>(null)
  const [draggingSplitSessionId, setDraggingSplitSessionId] = useState<string | null>(null)
  const [isSplitPanePreviewActive, setIsSplitPanePreviewActive] = useState(false)
  const workspaceDropRef = useRef<HTMLDivElement>(null)
  const tabDragVisitedWorkspaceRef = useRef(false)
  const splitLayout = controlledSplitLayout !== undefined ? controlledSplitLayout : internalSplitLayout
  const setSplitLayout = useCallback((updater: SplitLayoutUpdater) => {
    if (setControlledSplitLayout) {
      setControlledSplitLayout(updater)
      return
    }

    setInternalSplitLayout(updater)
  }, [setControlledSplitLayout])

  const workspaceSessionIdSet = useMemo(
    () => new Set(workspaceSessions.map((session) => session.id)),
    [workspaceSessions]
  )
  const hiddenSplitSessionId = isSplitPanePreviewActive ? draggingSplitSessionId : null
  const detachedSessionIds = useMemo(() => getSplitLayoutSessionIds(splitLayout), [splitLayout])
  const splitWorkspaceSessionIds = useMemo(
    () => detachedSessionIds.filter((id) => workspaceSessionIdSet.has(id)),
    [detachedSessionIds, workspaceSessionIdSet]
  )
  const splitWorkspaceSessionIdSet = useMemo(
    () => new Set(splitWorkspaceSessionIds),
    [splitWorkspaceSessionIds]
  )
  const hasWorkspace = !!splitLayout && splitWorkspaceSessionIds.length > 1
  const isWorkspaceActive = hasWorkspace && splitWorkspaceSessionIdSet.has(activeSessionId)
  const activeWorkspaceSession = useMemo(
    () => workspaceSessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, workspaceSessions]
  )

  const visibleSessionIds = useMemo(() => {
    if (isWorkspaceActive) {
      return splitWorkspaceSessionIds
    }

    if (isActiveConfigSession) return []

    const singleVisibleId = getSingleVisibleSessionId?.({
      activeSessionId,
      activeWorkspaceSession,
      workspaceSessions,
    }) ?? activeWorkspaceSession?.id ?? workspaceSessions[0]?.id ?? null

    return singleVisibleId ? [singleVisibleId] : []
  }, [
    activeSessionId,
    activeWorkspaceSession,
    getSingleVisibleSessionId,
    isActiveConfigSession,
    isWorkspaceActive,
    splitWorkspaceSessionIds,
    workspaceSessions,
  ])
  const visibleSessionIdSet = useMemo(() => new Set(visibleSessionIds), [visibleSessionIds])
  const isMultiSessionGrid = isWorkspaceActive && visibleSessionIds.length > 1
  const workspaceTabSession = useMemo(
    () => createWorkspaceTabSession({ id: workspaceTabId, label: workspaceTabLabel }),
    [workspaceTabId, workspaceTabLabel]
  )
  const tabSessions = useMemo(() => {
    if (buildTabSessions) {
      return buildTabSessions({
        hasWorkspace,
        workspaceTabSession,
        workspaceSessionIds: splitWorkspaceSessionIds,
        sessions,
      })
    }

    if (!hasWorkspace) return sessions

    const detachedSet = new Set(splitWorkspaceSessionIds)
    return [
      workspaceTabSession,
      ...sessions.filter((session) => !detachedSet.has(session.id)),
    ]
  }, [buildTabSessions, hasWorkspace, sessions, splitWorkspaceSessionIds, workspaceTabSession])
  const tabActiveId = isWorkspaceActive ? workspaceTabId : activeSessionId

  const handleActivateWorkspaceSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    onWorkspaceSessionActivated?.(sessionId)
  }, [onWorkspaceSessionActivated, setActiveSessionId])

  const handleChangeActiveSession = useCallback((nextSessionId: string) => {
    if (nextSessionId === workspaceTabId) {
      const nextWorkspaceSessionId = splitWorkspaceSessionIdSet.has(activeSessionId)
        ? activeSessionId
        : splitWorkspaceSessionIds[0]
      if (nextWorkspaceSessionId) {
        handleActivateWorkspaceSession(nextWorkspaceSessionId)
      }
      return
    }

    setActiveSessionId(nextSessionId)
    if (!splitWorkspaceSessionIdSet.has(nextSessionId)) {
      onWorkspaceExited?.()
    }
  }, [
    activeSessionId,
    handleActivateWorkspaceSession,
    onWorkspaceExited,
    setActiveSessionId,
    splitWorkspaceSessionIds,
    splitWorkspaceSessionIdSet,
    workspaceTabId,
  ])

  const handleDetachSession = useCallback((sessionId: string) => {
    if (!workspaceSessionIdSet.has(sessionId)) return

    setSplitLayout((current) => {
      const cleaned = filterSplitLayout(current, workspaceSessionIdSet)
      if (getSplitLayoutSessionIds(cleaned).includes(sessionId)) {
        return cleaned
      }

      const targetSessionId = getDetachTargetSessionId?.({
        activeSessionId,
        activeWorkspaceSession,
        workspaceSessions,
      }) ?? activeWorkspaceSession?.id ?? null

      return addSessionToSplitLayout({
        layout: cleaned,
        sessionId,
        targetSessionId,
        side: "right",
        fallbackSessionIds: workspaceSessions.map((session) => session.id),
      })
    })
    handleActivateWorkspaceSession(sessionId)
  }, [
    activeSessionId,
    activeWorkspaceSession,
    getDetachTargetSessionId,
    handleActivateWorkspaceSession,
    setSplitLayout,
    workspaceSessionIdSet,
    workspaceSessions,
  ])

  const getSessionById = useCallback((sessionId: string) => (
    sessions.find((session) => session.id === sessionId)
      ?? workspaceSessions.find((session) => session.id === sessionId)
      ?? null
  ), [sessions, workspaceSessions])

  const getTabDropTarget = useCallback((event: SessionTabDragEvent) => {
    const workspaceElement = workspaceDropRef.current
    const workspaceRect = workspaceElement?.getBoundingClientRect()
    if (!workspaceElement || !workspaceRect) return null
    if (event.clientX < workspaceRect.left || event.clientX > workspaceRect.right) return null
    if (event.clientY < workspaceRect.top || event.clientY > workspaceRect.bottom) return null

    const paneElements = Array.from(
      workspaceElement.querySelectorAll<HTMLElement>("[data-split-session-id]")
    )
    const paneElement = paneElements.find((element) => {
      const targetSessionId = element.dataset.splitSessionId ?? null
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
      const targetSessionId = paneElement.dataset.splitSessionId ?? null
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

    const fallbackTargetId = getDetachTargetSessionId?.({
      activeSessionId,
      activeWorkspaceSession,
      workspaceSessions,
    }) ?? activeWorkspaceSession?.id ?? workspaceSessions[0]?.id ?? null

    return {
      side: getDropSideFromRect(event, workspaceRect),
      targetSessionId: fallbackTargetId && fallbackTargetId !== event.sessionId
        ? fallbackTargetId
        : workspaceSessions.find((session) => session.id !== event.sessionId)?.id ?? null,
    }
  }, [activeSessionId, activeWorkspaceSession, getDetachTargetSessionId, workspaceSessions])

  const isSessionDropDisabled = useCallback((event: SessionTabDragEvent) => (
    isDisabled || event.session.type === "config" || event.sessionId === workspaceTabId
  ), [isDisabled, workspaceTabId])

  const clearDropTarget = useCallback(() => {
    setTabDropSide(null)
    setTabDropTargetId(null)
  }, [])

  const clearSplitPaneDragState = useCallback(() => {
    tabDragVisitedWorkspaceRef.current = false
    setDraggingSplitSessionId(null)
    setIsSplitPanePreviewActive(false)
    clearDropTarget()
  }, [clearDropTarget])

  useEffect(() => {
    if (!draggingSplitSessionId) return

    const handleGlobalDragEnd = () => {
      clearSplitPaneDragState()
    }
    const handleGlobalDrop = () => {
      window.setTimeout(clearSplitPaneDragState, 0)
    }
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearSplitPaneDragState()
      }
    }

    window.addEventListener("dragend", handleGlobalDragEnd, true)
    window.addEventListener("drop", handleGlobalDrop, true)
    window.addEventListener("keydown", handleGlobalKeyDown, true)

    return () => {
      window.removeEventListener("dragend", handleGlobalDragEnd, true)
      window.removeEventListener("drop", handleGlobalDrop, true)
      window.removeEventListener("keydown", handleGlobalKeyDown, true)
    }
  }, [clearSplitPaneDragState, draggingSplitSessionId])

  const updateWorkspaceDropTarget = useCallback((event: SessionTabDragEvent) => {
    if (isSessionDropDisabled(event)) {
      clearDropTarget()
      return false
    }

    const target = getTabDropTarget(event)
    if (target) {
      tabDragVisitedWorkspaceRef.current = true
    }
    const nextSide = target?.side ?? null
    const nextTargetId = target?.targetSessionId ?? null
    setTabDropSide((current) => (current === nextSide ? current : nextSide))
    setTabDropTargetId((current) => (current === nextTargetId ? current : nextTargetId))
    return !!target
  }, [clearDropTarget, getTabDropTarget, isSessionDropDisabled])

  const dropSessionToWorkspace = useCallback((event: SessionTabDragEvent) => {
    if (isSessionDropDisabled(event)) return false

    const target = getTabDropTarget(event)
    if (!target || !target.targetSessionId) return false

    setSplitLayout((current) => addSessionToSplitLayout({
      layout: filterSplitLayout(current, workspaceSessionIdSet),
      sessionId: event.sessionId,
      targetSessionId: target.targetSessionId,
      side: target.side,
      fallbackSessionIds: getDropFallbackSessionIds?.({
        activeSessionId,
        activeWorkspaceSession,
        workspaceSessions,
      }) ?? [
        activeWorkspaceSession?.id,
        ...workspaceSessions.map((session) => session.id),
      ].filter((id): id is string => Boolean(id)),
    }))
    handleActivateWorkspaceSession(event.sessionId)
    onSessionDroppedToWorkspace?.(event.sessionId)
    return true
  }, [
    activeSessionId,
    activeWorkspaceSession,
    getDropFallbackSessionIds,
    getTabDropTarget,
    handleActivateWorkspaceSession,
    isSessionDropDisabled,
    onSessionDroppedToWorkspace,
    setSplitLayout,
    workspaceSessionIdSet,
    workspaceSessions,
  ])

  const createNativeDragEvent = useCallback((
    event: ReactDragEvent<HTMLElement>,
    session: TerminalSession,
  ): SessionTabDragEvent => ({
    session,
    sessionId: session.id,
    clientX: event.clientX,
    clientY: event.clientY,
    deltaX: 0,
    deltaY: 0,
    isOverTabBar: false,
  }), [])

  const handleTabDragStart = useCallback(() => {
    tabDragVisitedWorkspaceRef.current = false
    setDraggingSplitSessionId(null)
    setIsSplitPanePreviewActive(false)
    clearDropTarget()
  }, [clearDropTarget])

  const handleTabDragMove = useCallback((event: SessionTabDragEvent) => {
    updateWorkspaceDropTarget(event)
  }, [updateWorkspaceDropTarget])

  const handleTabDragEnd = useCallback((event: SessionTabDragEvent) => {
    const visitedWorkspace = tabDragVisitedWorkspaceRef.current
    tabDragVisitedWorkspaceRef.current = false
    setDraggingSplitSessionId(null)
    setIsSplitPanePreviewActive(false)
    clearDropTarget()

    if (dropSessionToWorkspace(event)) {
      return true
    }

    if (detachedSessionIds.includes(event.sessionId) && visitedWorkspace && event.isOverTabBar) {
      setSplitLayout((current) => ensureMultiSessionLayout(removeSessionFromSplitLayout(current, event.sessionId)))
      handleActivateWorkspaceSession(event.sessionId)
      return true
    }

    return false
  }, [
    clearDropTarget,
    detachedSessionIds,
    dropSessionToWorkspace,
    handleActivateWorkspaceSession,
    setSplitLayout,
  ])

  const handleTabDragCancel = useCallback(() => {
    clearSplitPaneDragState()
  }, [clearSplitPaneDragState])

  const isEventOverSplitPane = useCallback((
    event: ReactDragEvent<HTMLElement>,
    sessionId: string,
  ) => {
    const workspaceElement = workspaceDropRef.current
    if (!workspaceElement) return false

    const paneElement = Array.from(
      workspaceElement.querySelectorAll<HTMLElement>("[data-split-session-id]")
    ).find((element) => element.dataset.splitSessionId === sessionId)
    if (!paneElement) return false

    const rect = paneElement.getBoundingClientRect()
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    )
  }, [])

  const handleWorkspaceNativeDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!hasSplitPaneDragSession(event.dataTransfer)) return

    const sessionId = getSplitPaneDragSessionId(event.dataTransfer) ?? draggingSplitSessionId
    const session = sessionId ? getSessionById(sessionId) : null
    if (!sessionId || !session) {
      clearDropTarget()
      return
    }

    const isDetachedSplitDrag = detachedSessionIds.includes(sessionId)
    if (isDetachedSplitDrag && draggingSplitSessionId !== sessionId) {
      setDraggingSplitSessionId(sessionId)
    }

    if (isDetachedSplitDrag && !isSplitPanePreviewActive) {
      if (isEventOverSplitPane(event, sessionId)) {
        clearDropTarget()
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        return
      }

      setIsSplitPanePreviewActive(true)
      clearDropTarget()
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      return
    }

    const canDrop = updateWorkspaceDropTarget(createNativeDragEvent(event, session))
    if (!canDrop) return

    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [
    clearDropTarget,
    createNativeDragEvent,
    detachedSessionIds,
    draggingSplitSessionId,
    getSessionById,
    isEventOverSplitPane,
    isSplitPanePreviewActive,
    updateWorkspaceDropTarget,
  ])

  const handleWorkspaceNativeDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!hasSplitPaneDragSession(event.dataTransfer)) return

    event.preventDefault()
    event.stopPropagation()

    const sessionId = getSplitPaneDragSessionId(event.dataTransfer) ?? draggingSplitSessionId
    const session = sessionId ? getSessionById(sessionId) : null
    if (!session) {
      clearSplitPaneDragState()
      return
    }

    dropSessionToWorkspace(createNativeDragEvent(event, session))
    clearSplitPaneDragState()
  }, [clearSplitPaneDragState, createNativeDragEvent, draggingSplitSessionId, dropSessionToWorkspace, getSessionById])

  const handleWorkspaceNativeDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget as Node | null
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return
    clearDropTarget()
  }, [clearDropTarget])

  const handleSplitPaneDragStart = useCallback((sessionId: string) => {
    if (isDisabled || !detachedSessionIds.includes(sessionId)) {
      clearSplitPaneDragState()
      return
    }

    tabDragVisitedWorkspaceRef.current = false
    setDraggingSplitSessionId(sessionId)
    setIsSplitPanePreviewActive(false)
    clearDropTarget()
  }, [clearDropTarget, clearSplitPaneDragState, detachedSessionIds, isDisabled])

  const handleSplitPaneDragEnd = useCallback(() => {
    clearSplitPaneDragState()
  }, [clearSplitPaneDragState])

  const handleSplitPaneDropToTab = useCallback((
    sessionId: string,
    targetSessionId: string,
    side: SessionTabDropSide,
  ) => {
    const session = getSessionById(sessionId)
    const targetSession = getSessionById(targetSessionId)
    if (!session || !targetSession || targetSession.type === "config") return false
    if (sessionId === targetSessionId) return false
    if (!workspaceSessionIdSet.has(sessionId) || !workspaceSessionIdSet.has(targetSessionId)) return false

    setSplitLayout((current) => addSessionToSplitLayout({
      layout: filterSplitLayout(current, workspaceSessionIdSet),
      sessionId: targetSessionId,
      targetSessionId: sessionId,
      side,
      fallbackSessionIds: [
        sessionId,
        ...workspaceSessions.map((item) => item.id),
      ],
    }))
    handleActivateWorkspaceSession(targetSessionId)
    onSessionDroppedToWorkspace?.(targetSessionId)
    clearSplitPaneDragState()
    return true
  }, [
    clearSplitPaneDragState,
    getSessionById,
    handleActivateWorkspaceSession,
    onSessionDroppedToWorkspace,
    setSplitLayout,
    workspaceSessionIdSet,
    workspaceSessions,
  ])

  const handleRestoreDetachedSession = useCallback((sessionId: string) => {
    if (!detachedSessionIds.includes(sessionId)) return

    setSplitLayout((current) => ensureMultiSessionLayout(removeSessionFromSplitLayout(current, sessionId)))
    handleActivateWorkspaceSession(sessionId)
    clearSplitPaneDragState()
  }, [clearSplitPaneDragState, detachedSessionIds, handleActivateWorkspaceSession, setSplitLayout])

  const handleSplitResize = useCallback((path: number[], sizes: number[]) => {
    setSplitLayout((current) => updateSplitLayoutSizes(current, path, sizes))
  }, [setSplitLayout])

  const syncSplitLayout = useCallback((validSessionIds: Set<string>) => {
    setSplitLayout((current) => ensureMultiSessionLayout(filterSplitLayout(current, validSessionIds)))
  }, [setSplitLayout])

  const removeSessionFromWorkspace = useCallback((sessionId: string) => {
    setSplitLayout((current) => ensureMultiSessionLayout(removeSessionFromSplitLayout(current, sessionId)))
  }, [setSplitLayout])

  const filterWorkspaceSessions = useCallback((validSessionIds: Set<string>) => {
    setSplitLayout((current) => ensureMultiSessionLayout(filterSplitLayout(current, validSessionIds)))
  }, [setSplitLayout])

  return {
    splitLayout,
    setSplitLayout,
    tabDropSide,
    tabDropTargetId,
    draggingSplitSessionId,
    hiddenSplitSessionId,
    isSplitPanePreviewActive,
    workspaceDropRef,
    detachedSessionIds,
    workspaceSessionIds: splitWorkspaceSessionIds,
    workspaceSessionIdSet: splitWorkspaceSessionIdSet,
    hasWorkspace,
    isWorkspaceActive,
    visibleSessionIds,
    visibleSessionIdSet,
    isMultiSessionGrid,
    workspaceTabSession,
    tabSessions,
    tabActiveId,
    handleChangeActiveSession,
    handleDetachSession,
    handleTabDragStart,
    handleTabDragMove,
    handleTabDragEnd,
    handleTabDragCancel,
    handleSplitPaneDragStart,
    handleWorkspaceNativeDragOver,
    handleWorkspaceNativeDrop,
    handleWorkspaceNativeDragLeave,
    handleSplitPaneDragEnd,
    handleSplitPaneDropToTab,
    handleRestoreDetachedSession,
    handleSplitResize,
    syncSplitLayout,
    removeSessionFromWorkspace,
    filterWorkspaceSessions,
  }
}
