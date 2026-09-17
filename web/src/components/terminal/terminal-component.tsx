import { resolveTerminalInactiveMinutes } from "./terminal-settings"
import { SessionWorkspaceToolbarContext } from "@/components/tabs/session-workspace-toolbar"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react"
import {
  SessionTabBar,
  type CrossSessionFileDragData,
  type SessionTabBarNewSessionAction,
} from "@/components/tabs/session-tab-bar"
import type {
  TerminalSession,
  TerminalConnectionPhase,
} from "@/components/terminal/types"
import type { Server } from "@/lib/server-types"
import { cn } from "@/lib/utils"
import { useTerminalStore } from "@/stores/terminal-store"
import { PageHeader } from "@/components/page-header"
import { ActivityLogPane } from "@/components/ssh-workspace/activity-log-pane"
import type { AIAssistantWorkspaceAdapters } from "@/components/ai-agent/ai-assistant-workspace-view"
import { ServerConnectionConfigs, type ServerConnectionConfigsApi } from "@/components/servers/server-connection-configs"
import { SessionSplitDropOverlay } from "@/components/tabs/session-split-drop-overlay"
import { SessionSplitPane } from "@/components/tabs/session-split-pane"
import { PersistentSessionContent, SessionContentSlot, useSessionContentHosts } from "@/components/tabs/session-content-host"
import { SessionDockview } from "@/components/tabs/session-dockview"
import {
  TerminalSettingsDialog,
} from "./terminal-settings-dialog"
import { useTerminalSettingsStore } from "@/stores/terminal-settings-store"
import { TabTerminalContent } from "./tab-terminal-content"
import { useTabUIStore } from "@/stores/tab-ui-store"
import { useTranslation } from "react-i18next"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { toast } from "@/components/ui/sonner"
import { useEffectiveThemeMode } from "@/hooks/use-effective-theme-mode"
import { useFileTransfer, type FileTransferSftpApi } from "@/hooks/useFileTransfer"
import { getErrorMessage } from "@/lib/error-utils"
import { formatSftpAuthError, useSftpAuthRetry } from "@/components/sftp/use-sftp-auth-retry"
import { createWorkspaceTransferAuthTicketProviderAdapter } from "@/lib/session/workspace-adapters"
import { useSessionSplitWorkspace } from "@/hooks/use-session-split-workspace"
import {
  getTerminalTheme,
} from "@/components/terminal/terminal-themes"
import {
  resolveTerminalAppThemeMode,
  resolveTerminalSurfaceMode,
  resolveTerminalThemeName,
} from "@/components/terminal/use-terminal-renderer-settings"

import type { WorkspaceTransferTask } from "@/lib/session/workspace"

type LoaderState = "entering" | "loading" | "exiting"

type LoaderAction =
  | { type: "sync"; sessions: TerminalSession[]; visibleSessionIds: ReadonlySet<string> }
  | { type: "animation-complete"; sessionId: string }

export interface TerminalExtraSessionRenderOptions {
  chrome?: "full" | "toolbar" | "content"
  surface?: "normal" | "transparent"
  isVisible?: boolean
  isActive?: boolean
  externalTransferTasks?: WorkspaceTransferTask[]
  onClearExternalTransfers?: () => void
  onCancelExternalTransfer?: (id: string) => void
  onPathChange?: (path: string) => void
  refreshRequestVersion?: number
  initialPath?: string
  initialPathBackStack?: string[]
  initialPathForwardStack?: string[]
  onHistoryChange?: (history: TerminalExtraSessionPathHistory) => void
}

export interface TerminalExtraSessionPathHistory {
  currentPath: string
  pathBackStack: string[]
  pathForwardStack: string[]
}

const reduceLoaderStates = (
  state: Record<string, LoaderState>,
  action: LoaderAction
): Record<string, LoaderState> => {
  switch (action.type) {
    case "animation-complete": {
      if (!state[action.sessionId]) {
        return state
      }

      const next = { ...state }
      delete next[action.sessionId]
      return next
    }
    case "sync": {
      let changed = false
      const next = { ...state }
      const sessionIds = new Set(action.sessions.map((session) => session.id))

      Object.keys(next).forEach((sessionId) => {
        if (!sessionIds.has(sessionId)) {
          delete next[sessionId]
          changed = true
        }
      })

      action.sessions.forEach((session) => {
        const shouldShow = shouldShowConnectionLoader(session)
        const currentState = next[session.id]
        const isVisible = action.visibleSessionIds.has(session.id)

        if (shouldShow) {
          if (!isVisible) {
            if (currentState !== "loading") {
              next[session.id] = "loading"
              changed = true
            }
            return
          }

          if (!currentState || currentState === "exiting") {
            next[session.id] = "entering"
            changed = true
          }
          return
        }

        if (!currentState) {
          return
        }

        if (!isVisible) {
          delete next[session.id]
          changed = true
          return
        }

        if (currentState !== "exiting") {
          next[session.id] = "exiting"
          changed = true
        }
      })

      return changed ? next : state
    }
    default:
      return state
  }
}

const TAB_SWITCH_CLEANUP_DELAY_MS = 120

const CONNECTION_LOADER_PHASES = new Set<TerminalConnectionPhase>([
  "idle",
  "ticket",
  "ws_connecting",
  "ssh_connecting",
  "authenticating",
  "reconnecting",
])

const shouldShowConnectionLoader = (session?: TerminalSession) => {
  const isResolvingConnectionTarget = !!(
    session?.serverId &&
    !session.host &&
    session.status === "reconnecting"
  )

  return !!(
    session &&
    session.type === "terminal" &&
    (session.shouldConnect || isResolvingConnectionTarget) &&
    CONNECTION_LOADER_PHASES.has(session.connectionPhase)
  )
}

type InternalBackHandler = {
  handle: () => boolean | Promise<boolean>
}

const getAdjacentSessionId = (sessions: TerminalSession[], sessionId: string) => {
  const currentIndex = sessions.findIndex((session) => session.id === sessionId)
  if (currentIndex === -1) {
    return sessions[0]?.id
  }

  const nextIndex = currentIndex < sessions.length - 1 ? currentIndex + 1 : currentIndex - 1
  return sessions[nextIndex]?.id
}

const orderSessionsById = (sessions: TerminalSession[], orderIds: string[]) => {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]))
  const ordered = orderIds
    .map((id) => sessionMap.get(id))
    .filter((session): session is TerminalSession => Boolean(session))
  const orderedIdSet = new Set(ordered.map((session) => session.id))
  const remaining = sessions.filter((session) => !orderedIdSet.has(session.id))

  return [...ordered, ...remaining]
}

const mergeVisibleSessionOrderIds = (
  currentOrderIds: string[],
  visibleOrderIds: string[],
  orderableIds: string[],
) => {
  const orderableIdSet = new Set(orderableIds)
  const visibleOrderIdSet = new Set(visibleOrderIds)
  const next: string[] = []
  let visibleIndex = 0

  currentOrderIds.forEach((id) => {
    if (!orderableIdSet.has(id)) return

    if (!visibleOrderIdSet.has(id)) {
      next.push(id)
      return
    }

    const nextVisibleId = visibleOrderIds[visibleIndex]
    visibleIndex += 1
    if (nextVisibleId && orderableIdSet.has(nextVisibleId)) {
      next.push(nextVisibleId)
    }
  })

  for (; visibleIndex < visibleOrderIds.length; visibleIndex += 1) {
    const id = visibleOrderIds[visibleIndex]
    if (orderableIdSet.has(id)) {
      next.push(id)
    }
  }

  const nextIdSet = new Set(next)
  orderableIds.forEach((id) => {
    if (!nextIdSet.has(id)) {
      next.push(id)
    }
  })

  return next
}

const TERMINAL_WORKSPACE_TAB_ID = "__terminal-workspace__"
const WORKSPACE_TAB_LABEL = "工作空间"
const DEFAULT_TERMINAL_SFTP_PATH = "/root"

const disabledFileTransferApi: FileTransferSftpApi = {
  async createUploadTask() {
    throw new Error("SFTP transfer API is unavailable")
  },
  async listUploadTasks() {
    return { tasks: [] }
  },
  async cancelUploadTask() {
    return undefined
  },
  async uploadFile() {
    throw new Error("SFTP transfer API is unavailable")
  },
  async directTransfer() {
    throw new Error("SFTP transfer API is unavailable")
  },
  async cancelTransfer() {
    return undefined
  },
}

interface TerminalComponentProps {
  sessions: TerminalSession[]
  extraSessions?: TerminalSession[]
  extraNewSessionActions?: TerminalExtraNewSessionAction[]
  renderExtraSessionContent?: (session: TerminalSession, options?: TerminalExtraSessionRenderOptions) => ReactNode
  onOpenSftpSession?: (session: TerminalSession, path?: string) => void
  onCloseExtraSession?: (sessionId: string) => void
  onReorderExtraSessions?: (newOrderIds: string[]) => void
  externalActiveExtraSessionId?: string | null
  onActiveExtraSessionChange?: (sessionId: string | null) => void
  inactiveReminderLimit?: number
  onCloseSession: (sessionId: string) => void
  onCloseSessions?: (sessionIds: string[]) => void
  onSendCommand: (sessionId: string, command: string) => void
  onDuplicateSession: (sessionId: string) => void
  onCloseOthers: (sessionId: string) => void
  onCloseAll: () => void
  onTogglePin: (sessionId: string) => void
  onReorderSessions: (newOrderIds: string[]) => void
  // 选择服务器后创建会话，返回新页签 ID。
  onStartConnection: (server: Server) => string | void
  onAuthCancelled?: (sessionId: string) => void
  // 外部控制激活的会话 ID
  externalActiveSessionId?: string | null
  onActiveSessionChange?: (sessionId: string | null) => void
  onConnectionPhaseChange?: (sessionId: string, phase: TerminalConnectionPhase) => void
  serverApi?: ServerConnectionConfigsApi
  serverConfigsReady?: boolean
  aiAssistantAdapters?: AIAssistantWorkspaceAdapters
  hidePageHeader?: boolean
  unframed?: boolean
  settingsDialogOpen?: boolean
  onSettingsDialogOpenChange?: (open: boolean) => void
  tabBarEndContent?: ReactNode
}

export interface TerminalExtraNewSessionAction {
  id: string
  label: string
  onCreate: () => string | void
  ariaLabel?: string
  title?: string
}

export function TerminalComponent({
  sessions,
  extraSessions = [],
  extraNewSessionActions = [],
  renderExtraSessionContent,
  onOpenSftpSession,
  onCloseExtraSession,
  onReorderExtraSessions,
  externalActiveExtraSessionId,
  onActiveExtraSessionChange,
  onCloseSession,
  inactiveReminderLimit,
  onCloseSessions,
  onSendCommand,
  onDuplicateSession,
  onCloseOthers,
  onCloseAll,
  onTogglePin,
  onReorderSessions,
  onStartConnection,
  onAuthCancelled,
  externalActiveSessionId,
  onActiveSessionChange,
  onConnectionPhaseChange,
  serverApi,
  serverConfigsReady,
  aiAssistantAdapters,
  hidePageHeader = false,
  unframed = false,
  settingsDialogOpen,
  onSettingsDialogOpenChange,
  tabBarEndContent,
}: TerminalComponentProps) {
  const { t: tTerminal } = useTranslation("terminal")
  const { t: tSftpFallback } = useTranslation("sftp")
  const {
    mode: effectiveAppTheme,
    version: effectiveThemeVersion,
  } = useEffectiveThemeMode()
  const workspace = useOptionalSshWorkspace()
  const workspaceTheme = workspace?.adapters.theme
  const workspaceSftpApi = workspace?.adapters.apiClient?.sftp
  const workspaceI18n = workspace?.adapters.i18n
  const tSftp = useCallback((key: string, params?: Record<string, string | number>) => {
    const workspaceText = workspaceI18n?.t("sftp", key, params)
    if (workspaceText && workspaceText !== key) {
      return workspaceText
    }

    return tSftpFallback(key, params)
  }, [tSftpFallback, workspaceI18n])
  const {
    credentialDialog: sftpTransferCredentialDialog,
    runDirectTransferWithCredentialRetry,
  } = useSftpAuthRetry({
    tTerminal,
  })
  const canUseCrossSessionDragCapability = workspace?.capabilities.crossSessionDrag === true
  const crossSessionFileTransferApi = useMemo<FileTransferSftpApi | undefined>(() => {
    if (
      !canUseCrossSessionDragCapability ||
      !workspaceSftpApi?.createUploadTask ||
      !workspaceSftpApi.listUploadTasks ||
      !workspaceSftpApi.cancelUploadTask ||
      !workspaceSftpApi.uploadFile ||
      !workspaceSftpApi.directTransfer ||
      !workspaceSftpApi.cancelTransfer
    ) {
      return undefined
    }

    return {
      createUploadTask: workspaceSftpApi.createUploadTask,
      listUploadTasks: workspaceSftpApi.listUploadTasks,
      getUploadTask: workspaceSftpApi.getUploadTask,
      getTransferTask: workspaceSftpApi.getTransferTask,
      cancelUploadTask: workspaceSftpApi.cancelUploadTask,
      uploadFile: workspaceSftpApi.uploadFile,
      directTransfer: (sourceServerId, sourcePath, targetServerId, targetPath, options) => (
        runDirectTransferWithCredentialRetry({
          sourceServerId,
          sourcePath,
          sourceServerName: options?.sourceServerName ?? sourceServerId,
          sourceAuthMethod: options?.sourceAuthMethod ?? "password",
          targetServerId,
          targetPath,
          targetServerName: options?.targetServerName ?? targetServerId,
          targetAuthMethod: options?.targetAuthMethod ?? "password",
          api: workspaceSftpApi,
          operation: (credentialOptions) => {
            const directTransfer = workspaceSftpApi.directTransfer
            if (!directTransfer) {
              return Promise.reject(new Error("SFTP direct transfer is unavailable"))
            }

            return directTransfer(
              sourceServerId,
              sourcePath,
              targetServerId,
              targetPath,
              {
                ...options,
                ...(credentialOptions ?? {}),
              },
            )
          },
        })
      ),
      cancelTransfer: workspaceSftpApi.cancelTransfer,
    }
  }, [canUseCrossSessionDragCapability, runDirectTransferWithCredentialRetry, workspaceSftpApi])
  const crossSessionTransferAuthTicketProvider = useMemo(
    () => createWorkspaceTransferAuthTicketProviderAdapter(workspace?.adapters.authTicketProvider),
    [workspace?.adapters.authTicketProvider]
  )
  const crossSessionTransfer = useFileTransfer({
    api: crossSessionFileTransferApi ?? disabledFileTransferApi,
    createTicket: crossSessionTransferAuthTicketProvider,
    uploadUsesProgressSocket: workspaceSftpApi?.uploadUsesProgressSocket ?? true,
    serverTransferUsesProgressSocket: workspaceSftpApi?.serverTransferUsesProgressSocket ?? true,
  })
  const canUseCrossSessionTransfer = !!crossSessionFileTransferApi
  const [activeSession, setActiveSession] = useState<string>(
    externalActiveExtraSessionId ?? externalActiveSessionId ?? ""
  )
  const [loaderStates, dispatchLoaderStates] = useReducer(reduceLoaderStates, {})
  const [internalSettingsOpen, setInternalSettingsOpen] = useState(false)
  const isSettingsOpen = settingsDialogOpen ?? internalSettingsOpen
  const setIsSettingsOpen = useCallback((open: boolean) => {
    if (settingsDialogOpen === undefined) {
      setInternalSettingsOpen(open)
    }
    onSettingsDialogOpenChange?.(open)
  }, [onSettingsDialogOpenChange, settingsDialogOpen])
  const [internalBackVersion, setInternalBackVersion] = useState(0)
  const [activeSessionHistoryVersion, setActiveSessionHistoryVersion] = useState(0)
  const activeSessionRef = useRef(activeSession)
  const activeSessionHistoryRef = useRef<string[]>([])
  const lastNotifiedActiveSessionRef = useRef(activeSession)
  const internalBackHandlersRef = useRef(new Map<string, InternalBackHandler>())
  const internalBackAvailabilityRef = useRef(new Map<string, boolean>())
  const internalBackSentinelArmedRef = useRef(false)
  const internalBackSentinelDisarmingRef = useRef(false)
  const [sftpPathBySessionId, setSftpPathBySessionId] = useState<Record<string, string>>({})
  const [sftpRefreshRequests, setSftpRefreshRequests] = useState<Record<string, number>>({})
  const [sftpHistoryBySessionId, setSftpHistoryBySessionId] = useState<Record<string, TerminalExtraSessionPathHistory>>({})
  const [combinedTabOrderIds, setCombinedTabOrderIds] = useState<string[]>([])

  // ==================== 从 Store 获取销毁方法 ====================
  const destroySession = useTerminalStore(state => state.destroySession)
  const workspaceSplitLayout = useTerminalStore(state => state.splitLayout)
  const setWorkspaceSplitLayout = useTerminalStore(state => state.setSplitLayout)
  const setTabState = useTabUIStore(state => state.setTabState)
  const deleteTabState = useTabUIStore(state => state.deleteTabState)

  // ==================== 获取活跃会话 ====================
  const sessionIdsKey = sessions.map(session => session.id).join("\0")
  const sessionIdSet = useMemo(() => new Set(sessionIdsKey.split("\0").filter(Boolean)), [sessionIdsKey])
  const extraSessionIdsKey = extraSessions.map(session => session.id).join("\0")
  const extraSessionIdSet = useMemo(() => new Set(extraSessionIdsKey.split("\0").filter(Boolean)), [extraSessionIdsKey])
  const terminalSessions = useMemo(
    () => sessions.filter((session) => session.type === "terminal"),
    [sessions]
  )
  const workspaceExtraSessions = useMemo(
    () => extraSessions.filter((session) => session.type === "sftp"),
    [extraSessions]
  )
  const workspaceSessions = useMemo(
    () => [...terminalSessions, ...workspaceExtraSessions],
    [terminalSessions, workspaceExtraSessions]
  )
  const getContentHost = useSessionContentHosts(workspaceSessions.map(session => session.id))
  const getToolbarHost = useSessionContentHosts(workspaceSessions.map(session => session.id))
  const contentSessionIdSet = useMemo(
    () => new Set([...sessionIdSet, ...extraSessionIdSet]),
    [extraSessionIdSet, sessionIdSet]
  )
  const active = sessions.find((s) => s.id === activeSession)
  const activeExtraSession = extraSessions.find((s) => s.id === activeSession) ?? null
  const isConnectionConfigVisible = !activeSession || contentSessionIdSet.size === 0
  const activeTerminalSession = active?.type === "terminal" ? active : null
  const crossSessionTransferTasks = crossSessionTransfer.tasks
  const clearCrossSessionCompletedTransfers = crossSessionTransfer.clearCompleted
  const cancelCrossSessionTransfer = crossSessionTransfer.cancelDirectTransfer
  const handleCancelCrossSessionTransfer = useCallback((taskId: string) => {
    void cancelCrossSessionTransfer(taskId)
  }, [cancelCrossSessionTransfer])

  const setActiveSessionFromUser = useCallback((nextSessionId: string) => {
    setActiveSession((previousSessionId) => {
      if (!nextSessionId || previousSessionId === nextSessionId) {
        return previousSessionId
      }

      if (previousSessionId && contentSessionIdSet.has(previousSessionId)) {
        activeSessionHistoryRef.current = [
          ...activeSessionHistoryRef.current.filter((id) => id !== previousSessionId),
          previousSessionId,
        ].slice(-20)
        setActiveSessionHistoryVersion((version) => version + 1)
      }

      return nextSessionId
    })
  }, [contentSessionIdSet])

  useEffect(() => {
    setSftpPathBySessionId((current) => {
      const nextEntries = Object.entries(current).filter(([sessionId]) => contentSessionIdSet.has(sessionId))
      if (nextEntries.length === Object.keys(current).length) {
        return current
      }
      return Object.fromEntries(nextEntries)
    })
    setSftpRefreshRequests((current) => {
      const nextEntries = Object.entries(current).filter(([sessionId]) => contentSessionIdSet.has(sessionId))
      if (nextEntries.length === Object.keys(current).length) {
        return current
      }
      return Object.fromEntries(nextEntries)
    })
    setSftpHistoryBySessionId((current) => {
      const nextEntries = Object.entries(current).filter(([sessionId]) => contentSessionIdSet.has(sessionId))
      if (nextEntries.length === Object.keys(current).length) {
        return current
      }
      return Object.fromEntries(nextEntries)
    })
  }, [contentSessionIdSet])

  const notifyTransferSuccess = useCallback((message: string) => {
    if (workspace?.adapters.notifier?.success) {
      workspace.adapters.notifier.success(message)
      return
    }
    toast.success(message)
  }, [workspace?.adapters.notifier])

  const notifyTransferError = useCallback((message: string) => {
    if (workspace?.adapters.notifier?.error) {
      workspace.adapters.notifier.error(message)
      return
    }
    toast.error(message)
  }, [workspace?.adapters.notifier])

  const handleSftpPathChange = useCallback((sessionId: string, path: string) => {
    setSftpPathBySessionId((current) => (
      current[sessionId] === path
        ? current
        : { ...current, [sessionId]: path }
    ))
  }, [])

  const handleSftpHistoryChange = useCallback((sessionId: string, history: TerminalExtraSessionPathHistory) => {
    setSftpHistoryBySessionId((current) => {
      const previous = current[sessionId]
      if (
        previous &&
        previous.currentPath === history.currentPath &&
        previous.pathBackStack.length === history.pathBackStack.length &&
        previous.pathForwardStack.length === history.pathForwardStack.length &&
        previous.pathBackStack.every((item, index) => item === history.pathBackStack[index]) &&
        previous.pathForwardStack.every((item, index) => item === history.pathForwardStack[index])
      ) {
        return current
      }

      return { ...current, [sessionId]: history }
    })
    handleSftpPathChange(sessionId, history.currentPath)
  }, [handleSftpPathChange])

  const requestSftpRefresh = useCallback((sessionId: string) => {
    setSftpRefreshRequests((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? 0) + 1,
    }))
  }, [])

  const isCrossSessionTransferSessionReady = useCallback((session?: TerminalSession | null) => (
    !!session &&
    session.id !== TERMINAL_WORKSPACE_TAB_ID &&
    !!session.serverId &&
    (
      (session.type === "terminal" && session.connectionPhase === "ready") ||
      session.type === "sftp"
    )
  ), [])

  const canAcceptCrossSessionFileDrop = useCallback((targetSession: TerminalSession) => (
    canUseCrossSessionTransfer && isCrossSessionTransferSessionReady(targetSession)
  ), [canUseCrossSessionTransfer, isCrossSessionTransferSessionReady])

  const handleCrossSessionFileDrop = useCallback(async (
    targetSessionId: string,
    dragData: CrossSessionFileDragData,
  ) => {
    if (!canUseCrossSessionTransfer) {
      return
    }

    const targetSession = workspaceSessions.find((session) => session.id === targetSessionId)
    const sourceSession = workspaceSessions.find((session) => session.id === dragData.sourceSessionId)

    if (!targetSession || !sourceSession) {
      return
    }

    if (
      !isCrossSessionTransferSessionReady(targetSession) ||
      !isCrossSessionTransferSessionReady(sourceSession)
    ) {
      notifyTransferError(tSftp("toastTransferSessionNotConnected"))
      return
    }

    if (sourceSession.serverId === targetSession.serverId) {
      notifyTransferError(tSftp("toastTransferSameServer"))
      return
    }

    const sourceServerId = sourceSession.serverId
    const targetServerId = targetSession.serverId
    if (!sourceServerId || !targetServerId) {
      notifyTransferError(tSftp("toastTransferSessionNotConnected"))
      return
    }

    const fallbackTargetPath = targetSession.type === "sftp" ? "/" : DEFAULT_TERMINAL_SFTP_PATH
    const targetPath = sftpPathBySessionId[targetSession.id] ?? fallbackTargetPath

    setActiveSessionFromUser(targetSession.id)
    if (targetSession.type === "terminal") {
      setTabState(targetSession.id, { isFileManagerOpen: true })
    }

    try {
      await crossSessionTransfer.directTransfer(
        sourceServerId,
        dragData.filePath,
        targetServerId,
        targetPath,
        sourceSession.serverName,
        targetSession.serverName,
        dragData.fileName,
        {
          sourceAuthMethod: sourceSession.authMethod ?? "password",
          targetAuthMethod: targetSession.authMethod ?? "password",
        },
      )
      requestSftpRefresh(targetSession.id)
      notifyTransferSuccess(tSftp("toastTransferSuccess", {
        file: dragData.fileName,
        size: "-",
      }))
    } catch (error) {
      notifyTransferError(formatSftpAuthError(error, getErrorMessage(error, tSftp("toastTransferFailed")), tTerminal))
    }
  }, [
    canUseCrossSessionTransfer,
    crossSessionTransfer,
    isCrossSessionTransferSessionReady,
    notifyTransferError,
    notifyTransferSuccess,
    requestSftpRefresh,
    setActiveSessionFromUser,
    setTabState,
    sftpPathBySessionId,
    tSftp,
    tTerminal,
    workspaceSessions,
  ])

  const {
    dockview,
    splitLayout,
    setSplitLayout,
    tabDropSide,
    tabDropTargetId,
    workspaceDropRef,
    detachedSessionIds,
    workspaceSessionIds,
    workspaceSessionIdSet: splitWorkspaceSessionIdSet,
    visibleSessionIdSet,
    isMultiSessionGrid,
    tabSessions,
    tabActiveId,
    handleChangeActiveSession,
    handleDetachSession,
    handleTabDragStart,
    handleTabDragMove,
    handleTabDragEnd,
    handleTabDragCancel,
    handleWorkspaceNativeDragOver,
    handleWorkspaceNativeDrop,
    handleWorkspaceNativeDragLeave,
    handleSplitPaneDropToTab,
    handleRestoreDetachedSession,
    syncSplitLayout,
    removeSessionFromWorkspace,
    filterWorkspaceSessions,
  } = useSessionSplitWorkspace({
    sessions,
    workspaceSessions,
    activeSessionId: activeSession,
    splitLayout: workspaceSplitLayout,
    setSplitLayout: setWorkspaceSplitLayout,
    workspaceTab: {
      id: TERMINAL_WORKSPACE_TAB_ID,
      label: WORKSPACE_TAB_LABEL,
    },
    isActiveConfigSession: isConnectionConfigVisible,
    setActiveSessionId: setActiveSessionFromUser,

  })
  const visibleExtraSessions = useMemo(
    () => extraSessions.filter((session) => !splitWorkspaceSessionIdSet.has(session.id)),
    [extraSessions, splitWorkspaceSessionIdSet]
  )
  const persistentTerminalSessions = useMemo(
    () => terminalSessions.filter((session) => !splitWorkspaceSessionIdSet.has(session.id)),
    [splitWorkspaceSessionIdSet, terminalSessions]
  )
  const isActiveExtraSessionInWorkspace = !!(
    activeExtraSession && splitWorkspaceSessionIdSet.has(activeExtraSession.id)
  )
  const unorderedCombinedTabSessions = useMemo(
    () => [...tabSessions, ...visibleExtraSessions],
    [tabSessions, visibleExtraSessions]
  )
  const orderableCombinedTabSessionIds = useMemo(
    () => [...tabSessions, ...extraSessions].map((session) => session.id),
    [extraSessions, tabSessions]
  )
  useEffect(() => {
    setCombinedTabOrderIds((current) => {
      const orderableIdSet = new Set(orderableCombinedTabSessionIds)
      const preserved = current.filter((id) => orderableIdSet.has(id))
      const preservedIdSet = new Set(preserved)
      const added = orderableCombinedTabSessionIds.filter((id) => !preservedIdSet.has(id))
      const next = [...preserved, ...added]

      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next
    })
  }, [orderableCombinedTabSessionIds])
  const combinedTabSessions = useMemo(
    () => orderSessionsById(unorderedCombinedTabSessions, combinedTabOrderIds),
    [combinedTabOrderIds, unorderedCombinedTabSessions]
  )
  const combinedActiveTabId = activeExtraSession && !isActiveExtraSessionInWorkspace
    ? activeExtraSession.id
    : tabActiveId
  const combinedExtraNewSessionActions = useMemo<SessionTabBarNewSessionAction[]>(() => (
    extraNewSessionActions.map((action) => ({
      id: action.id,
      label: action.label,
      ariaLabel: action.ariaLabel,
      title: action.title,
      onClick: () => {
        const id = action.onCreate()
        if (id) {
          setActiveSessionFromUser(String(id))
        }
        return id
      },
    }))
  ), [extraNewSessionActions, setActiveSessionFromUser])

  const handleChangeCombinedActiveSession = useCallback((nextSessionId: string) => {
    if (extraSessionIdSet.has(nextSessionId)) {
      setActiveSessionFromUser(nextSessionId)
      onActiveExtraSessionChange?.(nextSessionId)
      return
    }

    handleChangeActiveSession(nextSessionId)
  }, [
    extraSessionIdSet,
    handleChangeActiveSession,
    onActiveExtraSessionChange,
    setActiveSessionFromUser,
  ])

  const setActiveSessionWithoutHistory = useCallback((nextSessionId: string) => {
    setActiveSession(nextSessionId)
  }, [])

  // 当外部传入 activeSessionId 时，切换激活的会话
  useEffect(() => {
    if (
      externalActiveSessionId &&
      sessionIdSet.has(externalActiveSessionId)
	    ) {
      const frame = window.requestAnimationFrame(() => {
        setActiveSessionWithoutHistory(externalActiveSessionId)
      })
      return () => window.cancelAnimationFrame(frame)
    }
  }, [externalActiveSessionId, sessionIdSet, setActiveSessionWithoutHistory])

  useEffect(() => {
    if (
      externalActiveExtraSessionId &&
      extraSessionIdSet.has(externalActiveExtraSessionId)
    ) {
      const frame = window.requestAnimationFrame(() => {
        setActiveSessionWithoutHistory(externalActiveExtraSessionId)
      })
      return () => window.cancelAnimationFrame(frame)
    }
  }, [externalActiveExtraSessionId, extraSessionIdSet, setActiveSessionWithoutHistory])

  useEffect(() => {
    activeSessionRef.current = activeSession
    if (
      activeSession !== lastNotifiedActiveSessionRef.current
    ) {
      lastNotifiedActiveSessionRef.current = activeSession
      if (!activeSession) {
        onActiveSessionChange?.(null)
        onActiveExtraSessionChange?.(null)
      } else if (sessionIdSet.has(activeSession)) {
        onActiveSessionChange?.(activeSession)
        onActiveExtraSessionChange?.(null)
      } else if (extraSessionIdSet.has(activeSession)) {
        onActiveSessionChange?.(null)
        onActiveExtraSessionChange?.(activeSession)
      }
    }
  }, [
    activeSession,
    extraSessionIdSet,
    onActiveExtraSessionChange,
    onActiveSessionChange,
    sessionIdSet,
  ])

  useEffect(() => {
    const filteredHistory = activeSessionHistoryRef.current.filter((id) => contentSessionIdSet.has(id))

    if (filteredHistory.length !== activeSessionHistoryRef.current.length) {
      activeSessionHistoryRef.current = filteredHistory
      const frame = window.requestAnimationFrame(() => {
        setActiveSessionHistoryVersion((version) => version + 1)
      })
      return () => window.cancelAnimationFrame(frame)
    }
  }, [contentSessionIdSet])

  useEffect(() => {
    syncSplitLayout(new Set(workspaceSessions.map((session) => session.id)))
  }, [syncSplitLayout, workspaceSessions])

  const handleInternalBackHandlerChange = useCallback((
    sessionId: string,
    handler: InternalBackHandler | null
  ) => {
    if (handler) {
      internalBackHandlersRef.current.set(sessionId, handler)
      return
    }

    internalBackHandlersRef.current.delete(sessionId)
  }, [])

  const handleInternalBackAvailabilityChange = useCallback((
    sessionId: string,
    available: boolean
  ) => {
    const previous = internalBackAvailabilityRef.current.get(sessionId) ?? false

    if (available) {
      internalBackAvailabilityRef.current.set(sessionId, true)
    } else {
      internalBackAvailabilityRef.current.delete(sessionId)
    }

    if (previous !== available) {
      setInternalBackVersion((version) => version + 1)
    }
  }, [])

  const armInternalBackSentinel = useCallback(() => {
    if (typeof window === "undefined" || internalBackSentinelArmedRef.current) {
      return
    }

    window.history.pushState(
      {
        ...(window.history.state ?? {}),
        __easysshTerminalInternalBack: true,
      },
      "",
      window.location.href
    )
    internalBackSentinelArmedRef.current = true
  }, [])

  const disarmInternalBackSentinel = useCallback(() => {
    if (
      typeof window === "undefined" ||
      !internalBackSentinelArmedRef.current ||
      internalBackSentinelDisarmingRef.current
    ) {
      return
    }

    internalBackSentinelDisarmingRef.current = true
    window.history.back()
  }, [])

  useEffect(() => {
    if (!activeSession) return

    if (
      internalBackAvailabilityRef.current.get(activeSession) ||
      activeSessionHistoryRef.current.length > 0
    ) {
      armInternalBackSentinel()
      return
    }

    disarmInternalBackSentinel()
  }, [
    activeSession,
    activeSessionHistoryVersion,
    armInternalBackSentinel,
    disarmInternalBackSentinel,
    internalBackVersion,
  ])

  useEffect(() => {
    const handlePopState = () => {
      if (internalBackSentinelDisarmingRef.current) {
        internalBackSentinelDisarmingRef.current = false
        internalBackSentinelArmedRef.current = false
        return
      }

      if (!internalBackSentinelArmedRef.current) {
        return
      }

      internalBackSentinelArmedRef.current = false

      void (async () => {
        const sessionId = activeSessionRef.current
        const handler = sessionId
          ? internalBackHandlersRef.current.get(sessionId)
          : undefined

        let handled = false

        if (handler) {
          handled = await handler.handle()
        }

        if (!handled) {
          while (activeSessionHistoryRef.current.length > 0) {
            const previousSessionId = activeSessionHistoryRef.current[
              activeSessionHistoryRef.current.length - 1
            ]
            activeSessionHistoryRef.current = activeSessionHistoryRef.current.slice(0, -1)
            setActiveSessionHistoryVersion((version) => version + 1)

            if (contentSessionIdSet.has(previousSessionId)) {
              setActiveSessionWithoutHistory(previousSessionId)
              handled = true
              break
            }
          }
        }

        if (!handled) {
          window.history.back()
          return
        }

        window.setTimeout(() => {
          const currentSessionId = activeSessionRef.current
          if (
            currentSessionId &&
            (
              internalBackAvailabilityRef.current.get(currentSessionId) ||
              activeSessionHistoryRef.current.length > 0
            )
          ) {
            armInternalBackSentinel()
          }
        }, 50)
      })()
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [armInternalBackSentinel, contentSessionIdSet, setActiveSessionWithoutHistory])

  // 主题样式全部改为静态类 + dark: 前缀，避免 SSR/CSR 水合不一致

  const savedSettings = useTerminalSettingsStore(state => state.settings)
  const settings = useMemo(() => ({ ...savedSettings, inactiveMinutes: resolveTerminalInactiveMinutes(savedSettings.inactiveMinutes, inactiveReminderLimit) }), [savedSettings, inactiveReminderLimit])
  const handleSettingsChange = useTerminalSettingsStore(state => state.saveSettings)

  const effectiveTerminalTheme = resolveTerminalThemeName(workspaceTheme?.terminalTheme, settings.theme)
  const effectiveTerminalAppTheme = resolveTerminalAppThemeMode(workspaceTheme?.mode, effectiveAppTheme)
  const isGlassMaterial = settings.material === "glass"
  const hasWorkspaceBackground = isGlassMaterial || !!settings.backgroundImage
  const terminalTheme = useMemo(() => {
    // Workspace theme adapters may update in place; the version invalidates this memo.
    void effectiveThemeVersion
    return getTerminalTheme(effectiveTerminalTheme, effectiveTerminalAppTheme)
  }, [effectiveThemeVersion, effectiveTerminalTheme, effectiveTerminalAppTheme])

  // 如果当前激活的会话不存在（被删除），自动切换到合适的会话
  // 使用 ref 跟踪上一次的 sessions 数组，用于找到被删除页签的位置
  const prevSessionsRef = useRef(sessions)

  useEffect(() => {
    const prevSessions = prevSessionsRef.current
    const isSessionAdded = sessions.length > prevSessions.length

    // 更新 ref
    prevSessionsRef.current = sessions

    // 只在会话被删除（而非新增）且当前激活会话不存在时才切换
    if (activeSession && !active && !activeExtraSession && !isSessionAdded) {
      // 位置策略：优先激活右侧页签，没有则激活左侧
      // 找到被删除页签在原数组中的索引位置
      const deletedIndex = prevSessions.findIndex((s) => s.id === activeSession)

      let targetIndex = 0
      if (deletedIndex >= 0) {
        // 优先选择右侧页签（原索引位置，因为左侧页签会左移）
        // 如果右侧没有页签了（删除的是最后一个），则取最后一个页签
        targetIndex = Math.min(deletedIndex, sessions.length - 1)
      }

      const timer = setTimeout(() => {
        setActiveSessionWithoutHistory(sessions[targetIndex]?.id ?? extraSessions[0]?.id ?? "")
      }, 0)

      return () => clearTimeout(timer)
    }
  }, [active, activeExtraSession, sessions, extraSessions, activeSession, setActiveSessionWithoutHistory])

  const handleCommand = useCallback((sessionId: string, command: string) => {
    onSendCommand(sessionId, command)
  }, [onSendCommand])

  const handleReorderTabSessions = useCallback((newOrderIds: string[]) => {
    setCombinedTabOrderIds((current) => (
      mergeVisibleSessionOrderIds(current, newOrderIds, orderableCombinedTabSessionIds)
    ))
    onReorderSessions(newOrderIds.filter((id) => sessionIdSet.has(id)))
    onReorderExtraSessions?.(newOrderIds.filter((id) => extraSessionIdSet.has(id)))
  }, [
    extraSessionIdSet,
    onReorderExtraSessions,
    onReorderSessions,
    orderableCombinedTabSessionIds,
    sessionIdSet,
  ])

  const handleNewSessionClick = () => {
    setActiveSessionWithoutHistory("")
    onActiveSessionChange?.(null)
    onActiveExtraSessionChange?.(null)
  }

  const cleanupSession = useCallback((sessionId: string) => {
    destroySession(sessionId)
    deleteTabState(sessionId)
  }, [deleteTabState, destroySession])

  const cleanupSessionsWhenIdle = useCallback((sessionIds: string[]) => {
    const runCleanup = () => {
      sessionIds.forEach(cleanupSession)
    }

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(runCleanup, { timeout: 1000 })
      return
    }

    window.setTimeout(runCleanup, 0)
  }, [cleanupSession])

  const cleanupSessionsAfterDelay = useCallback((sessionIds: string[], delayMs: number) => {
    window.setTimeout(() => {
      cleanupSessionsWhenIdle(sessionIds)
    }, delayMs)
  }, [cleanupSessionsWhenIdle])

  const cleanupSessionsAfterTabSwitch = useCallback((sessionIds: string[]) => {
    cleanupSessionsAfterDelay(sessionIds, TAB_SWITCH_CLEANUP_DELAY_MS)
  }, [cleanupSessionsAfterDelay])

  // ==================== 页签关闭处理：先切换/导航，再清理终端资源，避免可见终端先被清空 ====================
  const handleCloseSession = useCallback((sessionId: string) => {
    if (extraSessionIdSet.has(sessionId)) {
      if (activeSession === sessionId) {
        const nextActiveSessionId = getAdjacentSessionId(combinedTabSessions, sessionId)
        if (nextActiveSessionId && nextActiveSessionId !== sessionId) {
          setActiveSessionWithoutHistory(nextActiveSessionId)
        } else {
          setActiveSessionWithoutHistory(sessions[0]?.id ?? "")
        }
      }
      removeSessionFromWorkspace(sessionId)
      onCloseExtraSession?.(sessionId)
      return
    }

    if (sessionId === TERMINAL_WORKSPACE_TAB_ID) {
      if (workspaceSessionIds.length === 0) {
        setSplitLayout(null)
        return
      }

      const closingWorkspaceIds = workspaceSessionIds.filter(id => !workspaceSessions.find(session => session.id === id)?.pinned)
      const terminalWorkspaceSessionIds = closingWorkspaceIds.filter((id) => sessionIdSet.has(id))
      const extraWorkspaceSessionIds = closingWorkspaceIds.filter((id) => extraSessionIdSet.has(id))
      const closingSessionIdSet = new Set(closingWorkspaceIds)
      const nextActiveSessionId = combinedTabSessions.find((session) => (
        session.id !== TERMINAL_WORKSPACE_TAB_ID &&
        !closingSessionIdSet.has(session.id)
      ))?.id ?? workspaceSessions.find(session => session.pinned)?.id ?? ""
      if (nextActiveSessionId) {
        setActiveSessionWithoutHistory(nextActiveSessionId)
      } else {
        setActiveSessionWithoutHistory("")
      }

      setSplitLayout(null)
      if (terminalWorkspaceSessionIds.length > 0) {
        if (onCloseSessions) {
          onCloseSessions(terminalWorkspaceSessionIds)
        } else {
          terminalWorkspaceSessionIds.forEach((id) => onCloseSession(id))
        }
        cleanupSessionsAfterTabSwitch(terminalWorkspaceSessionIds)
      }
      extraWorkspaceSessionIds.forEach((id) => onCloseExtraSession?.(id))
      return
    }

    if (activeSession === sessionId) {
      const nextActiveSessionId = getAdjacentSessionId(combinedTabSessions, sessionId)
      setActiveSessionWithoutHistory(nextActiveSessionId ?? "")
    }

    // 1. 通知父组件更新会话列表，让 UI 先切走
    removeSessionFromWorkspace(sessionId)
    onCloseSession(sessionId)
    // 2. 稍后再销毁终端实例和 WebSocket，避免可见页签先被清空
    cleanupSessionsAfterTabSwitch([sessionId])
  }, [
    activeSession,
    cleanupSessionsAfterTabSwitch,
    combinedTabSessions,
    extraSessionIdSet,
    onCloseExtraSession,
    onCloseSession,
    onCloseSessions,
    removeSessionFromWorkspace,
    sessionIdSet,
    sessions,
    setActiveSessionWithoutHistory,
    setSplitLayout,
    workspaceSessionIds,
    workspaceSessions,
  ])

  const handleCloseOthers = (sessionId: string) => {
    const remainingSessions = [...sessions, ...extraSessions].filter((session) => session.id === sessionId || session.pinned)
    const removedSessionIds = sessions
      .filter((session) => session.id !== sessionId && !session.pinned)
      .map((session) => session.id)

    if (!remainingSessions.some((session) => session.id === activeSession)) {
      const nextActiveSessionId = remainingSessions.find((session) => session.id === sessionId)?.id ?? remainingSessions[0]?.id
      if (nextActiveSessionId) {
        setActiveSessionWithoutHistory(nextActiveSessionId)
      }
    }

    // ==================== P0 修复：同样删除直接销毁监控连接的调用 ====================
    // 监控连接由引用计数自动管理
    // ❌ 旧代码（导致BUG）：
    // if (session.serverId) {
    //   destroyMonitorConnection(String(session.serverId))
    // }
    onCloseOthers(sessionId)
    filterWorkspaceSessions(new Set(remainingSessions.map((session) => session.id)))
    cleanupSessionsAfterTabSwitch(removedSessionIds)
  }

  const handleCloseAll = () => {
    const pinnedSessions = [...sessions, ...extraSessions].filter((session) => session.pinned)

    if (!pinnedSessions.some((session) => session.id === activeSession)) {
      setActiveSessionWithoutHistory(pinnedSessions[0]?.id ?? "")
    }

    const removedSessionIds = sessions
      .filter((session) => !session.pinned)
      .map((session) => session.id)

    // ==================== P0 修复：同样删除直接销毁监控连接的调用 ====================
    // 监控连接由引用计数自动管理
    // ❌ 旧代码（导致BUG）：
    // if (session.serverId) {
    //   destroyMonitorConnection(String(session.serverId))
    // }
    onCloseAll()
    filterWorkspaceSessions(new Set(pinnedSessions.map((session) => session.id)))
    cleanupSessionsAfterTabSwitch(removedSessionIds)
  }

  const handleAnimationComplete = useCallback((sessionId: string) => {
    dispatchLoaderStates({ type: "animation-complete", sessionId })
  }, [])

  const visibleLoaderSessionIds = useMemo(() => {
    const visibleIds = new Set<string>()

    if (isMultiSessionGrid && splitLayout) {
      workspaceSessionIds.forEach((sessionId) => {
        if (visibleSessionIdSet.has(sessionId) && sessionIdSet.has(sessionId)) {
          visibleIds.add(sessionId)
        }
      })
      return visibleIds
    }

    if (activeTerminalSession) {
      visibleIds.add(activeTerminalSession.id)
    }

    return visibleIds
  }, [
    activeTerminalSession,
    isMultiSessionGrid,
    sessionIdSet,
    splitLayout,
    workspaceSessionIds,
    visibleSessionIdSet,
  ])

  // Loader 只跟随连接 phase，不再依赖额外的 onLoadingChange 回调。
  useEffect(() => {
    dispatchLoaderStates({
      type: "sync",
      sessions,
      visibleSessionIds: visibleLoaderSessionIds,
    })
  }, [sessions, visibleLoaderSessionIds])

  const handleConnectFromHome = useCallback((server: Server) => {
    const sessionId = onStartConnection(server)
    if (sessionId) {
      setActiveSessionFromUser(sessionId)
    }
  }, [onStartConnection, setActiveSessionFromUser])

  const renderTerminalSessionContent = useCallback((
    session: TerminalSession,
    chrome: "full" | "toolbar" | "content",
    isVisible: boolean,
    surface: "normal" | "transparent" = "normal"
  ) => {
    const sessionLoaderState = loaderStates[session.id]
    const sessionIsLoading = !!(
      isVisible &&
      (shouldShowConnectionLoader(session) || sessionLoaderState)
    )

    return (
      <TabTerminalContent
        key={`terminal-content-${session.id}`}
        session={session}
        isActive={isVisible}
        keyboardActive={isVisible && activeSession === session.id && chrome !== "toolbar"}
        settings={settings}
        chrome={chrome}
        surface={surface}
        effectiveIsLoading={sessionIsLoading}
        loaderState={sessionLoaderState || "entering"}
        onAnimationComplete={handleAnimationComplete}
        onCommand={handleCommand}
        onConnectionPhaseChange={onConnectionPhaseChange}
        onAuthCancelled={onAuthCancelled}
        aiAssistantAdapters={aiAssistantAdapters}
        onInternalBackHandlerChange={handleInternalBackHandlerChange}
        onInternalBackAvailabilityChange={handleInternalBackAvailabilityChange}
        onSftpPathChange={handleSftpPathChange}
        initialSftpPath={sftpPathBySessionId[session.id] ?? DEFAULT_TERMINAL_SFTP_PATH}
        sftpRefreshRequestVersion={sftpRefreshRequests[session.id] ?? 0}
        externalTransferTasks={crossSessionTransferTasks}
        onClearExternalCompletedTransfers={clearCrossSessionCompletedTransfers}
        onCancelExternalTransfer={handleCancelCrossSessionTransfer}
      />
    )
  }, [
    activeSession,
    clearCrossSessionCompletedTransfers,
    crossSessionTransferTasks,
    handleInternalBackAvailabilityChange,
    handleAnimationComplete,
    handleCommand,
    handleInternalBackHandlerChange,
    handleCancelCrossSessionTransfer,
    handleSftpPathChange,
    aiAssistantAdapters,
    loaderStates,
    onAuthCancelled,
    onConnectionPhaseChange,
    settings,
    sftpPathBySessionId,
    sftpRefreshRequests,
  ])

  const getExtraSessionRenderOptions = useCallback((
    session: TerminalSession,
    surface: "normal" | "transparent",
    isVisible: boolean = true,
  ): TerminalExtraSessionRenderOptions => {
    const sftpHistory = sftpHistoryBySessionId[session.id]

    return {
      chrome: "full",
      surface,
      isVisible,
      isActive: isVisible && activeSession === session.id,
      externalTransferTasks: crossSessionTransferTasks,
      onClearExternalTransfers: clearCrossSessionCompletedTransfers,
      onCancelExternalTransfer: handleCancelCrossSessionTransfer,
      onPathChange: (path) => handleSftpPathChange(session.id, path),
      refreshRequestVersion: sftpRefreshRequests[session.id] ?? 0,
      initialPath: sftpHistory?.currentPath ?? sftpPathBySessionId[session.id],
      initialPathBackStack: sftpHistory?.pathBackStack,
      initialPathForwardStack: sftpHistory?.pathForwardStack,
      onHistoryChange: (history) => handleSftpHistoryChange(session.id, history),
    }
  }, [
    activeSession,
    crossSessionTransferTasks,
    clearCrossSessionCompletedTransfers,
    handleCancelCrossSessionTransfer,
    handleSftpHistoryChange,
    handleSftpPathChange,
    sftpHistoryBySessionId,
    sftpPathBySessionId,
    sftpRefreshRequests,
  ])

  const renderPersistentSession = (sessionId: string): ReactNode => {
    const session = workspaceSessions.find((item) => item.id === sessionId)
    if (!session) return null

    const isSftpSession = session.type === "sftp"
    const inSplit = splitWorkspaceSessionIdSet.has(sessionId)
    const isVisible = inSplit ? isMultiSessionGrid && visibleSessionIdSet.has(sessionId) : activeSession === sessionId

    return (
      <SessionWorkspaceToolbarContext value={inSplit ? { host: getToolbarHost(session.id), kind: isSftpSession ? "sftp" : "terminal" } : null}>
      <SessionSplitPane
        key={session.id}
        sessionId={session.id}
        isVisible={isVisible}
        isSplit={inSplit}
        isSftp={isSftpSession}
        isActive={activeSession === session.id}
        backgroundColor={isSftpSession ? undefined : terminalTheme.background}
        surface={hasWorkspaceBackground ? "transparent" : "normal"}
        onFocus={isVisible ? () => setActiveSessionFromUser(session.id) : undefined}
        dropOverlay={!inSplit && <SessionSplitDropOverlay side={tabDropTargetId === session.id ? tabDropSide : null} />}
        canAcceptCrossSessionFileDrop={canAcceptCrossSessionFileDrop(session)}
        onCrossSessionFileDrop={(targetSessionId, dragData) => {
          void handleCrossSessionFileDrop(targetSessionId, dragData)
        }}
      >
        {isSftpSession
          ? renderExtraSessionContent?.(session, getExtraSessionRenderOptions(session, inSplit || hasWorkspaceBackground ? "transparent" : "normal", isVisible))
          : renderTerminalSessionContent(session, "full", isVisible, inSplit || hasWorkspaceBackground ? "transparent" : "normal")}
      </SessionSplitPane>
      </SessionWorkspaceToolbarContext>
    )
  }

  const renderSplitLeaf = useCallback((id: string) => <SessionContentSlot host={getContentHost(id)} />, [getContentHost])

  const renderWorkspaceToolbar = useCallback((id: string) => <SessionContentSlot host={getToolbarHost(id)} />, [getToolbarHost])

  // 键盘快捷键支持
  // AI 助手快捷键（Ctrl+K）已移至 TabTerminalContent 组件内部
  // 每个页签独立管理快捷键

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {sftpTransferCredentialDialog}
      {!hidePageHeader && (
        <PageHeader title={active?.serverName || activeExtraSession?.serverName || tTerminal("connectionConfigTitle")}>
          <ActivityLogPane />
        </PageHeader>
      )}

      <div className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        unframed ? "p-0" : "p-3 pt-0 sm:p-4 sm:pt-0"
      )}>
        <div
          data-terminal-workspace
          data-terminal-background-enabled={hasWorkspaceBackground}
          data-terminal-theme-mode={resolveTerminalSurfaceMode(effectiveTerminalTheme, effectiveTerminalAppTheme)}
          className={cn(
            "relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-colors",
            isGlassMaterial && "terminal-workspace-glass",
            unframed
              ? "bg-background text-foreground"
              : "rounded-xl border border-border/60 bg-background/70 text-foreground shadow-2xl"
          )}
        >
          {hasWorkspaceBackground && (
            <div
              aria-hidden="true"
              data-terminal-background
              className="pointer-events-none absolute inset-0 -z-10"
              style={{ backgroundColor: terminalTheme.background }}
            >
              {settings.backgroundImage && (
                <img
                  key={settings.backgroundImage}
                  src={settings.backgroundImage}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{ opacity: settings.backgroundImageOpacity / 100 }}
                />
              )}
            </div>
          )}
          {/* 页签栏（仅保留标签，不显示面包屑） */}
          <SessionTabBar
            sessions={combinedTabSessions}
            activeId={combinedActiveTabId}
            onChangeActive={handleChangeCombinedActiveSession}
            onNewSession={handleNewSessionClick}
            additionalNewSessionActions={combinedExtraNewSessionActions}
            onCloseSession={handleCloseSession}
            onDuplicateSession={onDuplicateSession}
            onOpenSftpSession={onOpenSftpSession ? id => { const session = sessions.find(item => item.id === id); if (session) onOpenSftpSession(session, sftpPathBySessionId[id]) } : undefined}
            onCloseOthers={handleCloseOthers}
            onCloseAll={handleCloseAll}
            onTogglePin={onTogglePin}
            onReorder={handleReorderTabSessions}
            onOpenSettings={() => setIsSettingsOpen(true)}
            hideBreadcrumb
            onDetachSession={handleDetachSession}
            canDetachSession={(session) => (
              session.type !== "config" &&
              session.id !== TERMINAL_WORKSPACE_TAB_ID
            )}
            canShowContextMenu={(session) => (
              session.id !== TERMINAL_WORKSPACE_TAB_ID
            )}
            detachedSessionIds={detachedSessionIds}
            onTabDragStart={handleTabDragStart}
            onTabDragMove={handleTabDragMove}
            onTabDragEnd={handleTabDragEnd}
            onTabDragCancel={handleTabDragCancel}
            onRestoreDetachedSession={handleRestoreDetachedSession}
            onSplitPaneDropToTab={handleSplitPaneDropToTab}
            canAcceptCrossSessionFileDrop={canAcceptCrossSessionFileDrop}
            onCrossSessionFileDrop={(targetSessionId, dragData) => {
              void handleCrossSessionFileDrop(targetSessionId, dragData)
            }}
            endContent={tabBarEndContent}
          />

          <div
            ref={workspaceDropRef}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            onDragOver={handleWorkspaceNativeDragOver}
            onDrop={handleWorkspaceNativeDrop}
            onDragLeave={handleWorkspaceNativeDragLeave}
          >
            {/*
              普通终端页签始终保留各自的组件树，切换时只改变可见性。
              这样监控 Provider、图表历史和 xterm 实例都不会因页签切换而重建；
              布局槽位只移动内容容器，会话组件始终由下方的稳定 portal 唯一挂载。
            */}
            {persistentTerminalSessions.map((session) => {
              const isVisible = !!(
                activeTerminalSession?.id === session.id &&
                !isMultiSessionGrid
              )

              return (
                <div
                  key={session.id}
                  aria-hidden={!isVisible}
                  className={cn(
                    "absolute inset-0 min-h-0 min-w-0 overflow-hidden",
                    isVisible
                      ? "visible z-10"
                      : "invisible z-0 pointer-events-none"
                  )}
                  onMouseDown={isVisible ? () => setActiveSessionFromUser(session.id) : undefined}
                >
                  <SessionContentSlot host={getContentHost(session.id)} />
                </div>
              )
            })}

            {isConnectionConfigVisible && (
              <div className="absolute inset-0 z-20 min-h-0 min-w-0 overflow-hidden">
                <ServerConnectionConfigs
                  onConnect={handleConnectFromHome}
                  serverApi={serverApi}
                  ready={serverConfigsReady}
                />
              </div>
            )}

            <div aria-hidden={!isMultiSessionGrid} inert={!isMultiSessionGrid} className={cn("absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden", isMultiSessionGrid ? "visible z-20" : "invisible z-0 pointer-events-none")}>
                <div className="relative flex min-h-0 min-w-0 flex-1 overflow-auto p-2">
                  <SessionDockview
                    controller={dockview}
                    sessions={workspaceSessions.filter(session => splitWorkspaceSessionIdSet.has(session.id))}
                    renderLeaf={renderSplitLeaf}
                    renderToolbar={renderWorkspaceToolbar}
                    dropTargetId={tabDropTargetId}
                    dropSide={tabDropSide}
                    canAcceptCrossSessionFileDrop={canAcceptCrossSessionFileDrop}
                    onCrossSessionFileDrop={(id, data) => { void handleCrossSessionFileDrop(id, data) }}
                    onDetach={handleRestoreDetachedSession}
                    onClose={handleCloseSession}
                  />
                </div>
              </div>

            {workspaceSessions.map(session => (
              <PersistentSessionContent key={session.id} host={getContentHost(session.id)}>
                {renderPersistentSession(session.id)}
              </PersistentSessionContent>
            ))}

            {/* SFTP 页签保留各自的列表和浏览状态，切换时只改变可见性。 */}
            {visibleExtraSessions.map((session) => {
              const isVisible = activeExtraSession?.id === session.id && !isMultiSessionGrid

              return (
                <div
                  key={session.id}
                  aria-hidden={!isVisible}
                  inert={!isVisible}
                  className={cn(
                    "absolute inset-0 min-h-0 min-w-0 overflow-hidden",
                    isVisible
                      ? "visible z-20"
                      : "invisible z-0 pointer-events-none"
                  )}
                  onMouseDown={isVisible ? () => setActiveSessionFromUser(session.id) : undefined}
                >
                  <SessionContentSlot host={getContentHost(session.id)} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 设置对话框 */}
      <TerminalSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={settings}
        inactiveReminderLimit={inactiveReminderLimit}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  )
}
