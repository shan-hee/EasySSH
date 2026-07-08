import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  DEFAULT_SYSTEM_CONFIG,
  SftpServerPickerDialog,
  SshWorkspace,
  TerminalComponent,
  TerminalSftpTabContent,
  WORKSPACE_CAPABILITY_PRESETS,
  createTerminalWorkspaceSessionControllerAdapter,
  createTerminalWorkspaceSessionStoreAdapter,
  createWorkspaceAdapters,
  createWorkspaceCapabilitiesFromRuntime,
  createWorkspaceI18nAdapter,
  createWorkspaceSettingsAdapter,
  toast,
  useTerminalStore,
  type Server,
  type DirectTransferOptions,
  type SshWorkspaceApiClient,
  type TerminalConnectionPhase,
  type TerminalExtraSessionRenderOptions,
  type TerminalSession,
} from "@easyssh/ssh-workspace/desktop"
import { i18n, type Locale } from "@/i18n"
import { getEffectiveLocale, saveLocaleToStorage } from "@/utils/datetime"
import { createDesktopActivityLogAdapter, createDesktopTransferHistoryAdapter, recordDesktopTerminalOpened } from "./adapters/desktop-activity-log-adapter"
import { createDesktopAIAssistantAdapters } from "./adapters/desktop-ai-adapters"
import { createDesktopPreferenceAdapter, loadDesktopPreferenceSnapshot, type DesktopPreferenceSnapshot } from "./adapters/desktop-preferences"
import { createDesktopRuntime, loadDesktopRuntime, type DesktopRuntimeBindingInfo } from "./adapters/desktop-runtime"
import { createDesktopServerApi, markDesktopServerConnected, saveDesktopVerifiedCredential } from "./adapters/desktop-server-api"
import { createDesktopDockerApi } from "./adapters/desktop-docker-api"
import { createDesktopMonitorApi } from "./adapters/desktop-monitor-api"
import { createDesktopScriptAdapters } from "./adapters/desktop-script-api"
import { createDesktopSftpApi } from "./adapters/desktop-sftp-api"
import { DesktopAIAssistantView } from "./shell/desktop-ai-assistant-view"
import { DesktopActivityLogsView } from "./shell/desktop-activity-logs-view"
import { DesktopBackupRestoreView } from "./shell/desktop-backup-restore-view"
import { DesktopProviders } from "./shell/desktop-providers"
import { DesktopScriptsView } from "./shell/desktop-scripts-view"
import { DesktopTitleBar, type DesktopView } from "./shell/desktop-titlebar"
import { DesktopUpdateFailureDialog } from "./shell/desktop-update-failure-dialog"
import { createDesktopTerminalSocket } from "./terminal/desktop-terminal-socket"
import { useFileTransfer, type FileTransferSftpApi } from "@/hooks/useFileTransfer"

const defaultMaxTabs = 50
const defaultInactiveMinutes = 60

function statusFromConnectionPhase(phase: TerminalConnectionPhase) {
  if (phase === "ready") return "connected" as const
  if (phase === "failed" || phase === "closed" || phase === "idle") return "disconnected" as const
  return "reconnecting" as const
}

function createConfigSession(connectionConfigName: string, id = "config-initial"): TerminalSession {
  const now = Date.now()

  return {
    id,
    serverName: connectionConfigName,
    host: "",
    port: undefined,
    username: "",
    shouldConnect: false,
    connectionPhase: "idle",
    status: "disconnected",
    lastActivity: now,
    type: "config",
    pinned: false,
  }
}

function createTerminalSessionFromServer(
  sessionId: string,
  server: Server,
  now = Date.now(),
): TerminalSession {
  return {
    id: sessionId,
    serverId: String(server.id),
    authMethod: server.auth_method,
    serverName: server.name || `${server.username}@${server.host}:${server.port}`,
    host: server.host,
    port: server.port,
    username: server.username,
    shouldConnect: true,
    connectionPhase: "idle",
    status: "reconnecting",
    lastActivity: now,
    group: server.group,
    tags: server.tags,
    pinned: false,
    type: "terminal",
  }
}

type DesktopSftpTab = {
  id: string
  label: string
  server: Server
  createdAt: number
}

function createSftpTabId() {
  return `desktop-sftp-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getServerDisplayName(server: Server) {
  return server.name || `${server.username}@${server.host}:${server.port}`
}

function createSftpTabSession(tab: DesktopSftpTab): TerminalSession {
  return {
    id: tab.id,
    serverId: String(tab.server.id),
    authMethod: tab.server.auth_method,
    serverName: tab.label,
    host: tab.server.host,
    port: tab.server.port,
    username: tab.server.username,
    shouldConnect: false,
    connectionPhase: "ready",
    status: "connected",
    lastActivity: tab.createdAt,
    group: tab.server.group,
    tags: tab.server.tags,
    pinned: false,
    type: "sftp",
  }
}

function shouldCheckTerminalInactivity(session: TerminalSession) {
  return (
    session.type === "terminal" &&
    !!session.serverId &&
    session.connectionPhase === "ready" &&
    session.status === "connected"
  )
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => getEffectiveLocale(null, DEFAULT_SYSTEM_CONFIG))
  const [runtime, setRuntime] = useState<DesktopRuntimeBindingInfo | null>(null)
  const [runtimeLoaded, setRuntimeLoaded] = useState(false)
  const [preferenceSnapshot, setPreferenceSnapshot] = useState<DesktopPreferenceSnapshot | null>(null)
  const [activeView, setActiveView] = useState<DesktopView>("terminal")
  const [aiAssistantMounted, setAiAssistantMounted] = useState(false)
  const [scriptsMounted, setScriptsMounted] = useState(false)
  const [activityLogsMounted, setActivityLogsMounted] = useState(false)
  const [backupRestoreMounted, setBackupRestoreMounted] = useState(false)
  const [maxTabs, setMaxTabs] = useState(defaultMaxTabs)
  const [inactiveMinutes, setInactiveMinutes] = useState(defaultInactiveMinutes)
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false)
  const [sftpTabs, setSftpTabs] = useState<DesktopSftpTab[]>([])
  const [activeSftpTabId, setActiveSftpTabId] = useState<string | null>(null)
  const [sftpPickerOpen, setSftpPickerOpen] = useState(false)
  const inactivityNotifiedRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)

  const sessions = useTerminalStore((state) => state.sessions)
  const activeSessionId = useTerminalStore((state) => state.activeSessionId)
  const setSessions = useTerminalStore((state) => state.setSessions)
  const setActiveSessionId = useTerminalStore((state) => state.setActiveSessionId)
  const updateSessionActivity = useTerminalStore((state) => state.updateSessionActivity)
  const getSessionLastActivity = useTerminalStore((state) => state.getSessionLastActivity)
  const { t: tCommon } = useTranslation("common")
  const { t: tTerminal } = useTranslation("terminal")
  const { t: tSftp } = useTranslation("sftp")
  const connectionConfigName = tTerminal("connectionConfigTitle")

  const serverApi = useMemo(() => createDesktopServerApi(), [])
  const scriptAdapters = useMemo(() => createDesktopScriptAdapters(serverApi), [serverApi])
  const aiAssistantAdapters = useMemo(() => createDesktopAIAssistantAdapters(serverApi), [serverApi])
  const activityLog = useMemo(() => createDesktopActivityLogAdapter(), [])
  const transferHistory = useMemo(() => createDesktopTransferHistoryAdapter(), [])
  const workspaceSessionStore = useMemo(() => createTerminalWorkspaceSessionStoreAdapter(), [])
  const workspaceSessionController = useMemo(() => createTerminalWorkspaceSessionControllerAdapter(), [])
  const workspacePreferences = useMemo(() => createDesktopPreferenceAdapter(preferenceSnapshot ?? {}), [preferenceSnapshot])
  const desktopTransferTicketProvider = useCallback(async () => ({ ticket: "desktop" }), [])
  const desktopGateway = runtime?.gateway
  const desktopGatewayWsBaseUrl = desktopGateway?.wsBaseUrl
  const desktopGatewayToken = desktopGateway?.token
  const desktopTerminalGatewayReady = Boolean(desktopGatewayWsBaseUrl && desktopGatewayToken)
  const desktopTerminalTransportReady = desktopTerminalGatewayReady || runtimeLoaded
  const sftpApi = useMemo(() => createDesktopSftpApi(desktopGateway, runtimeLoaded), [desktopGateway, runtimeLoaded])
  const fileTransfer = useFileTransfer({
    api: sftpApi as FileTransferSftpApi,
    createTicket: desktopTransferTicketProvider,
    uploadUsesProgressSocket: sftpApi.uploadUsesProgressSocket,
    serverTransferUsesProgressSocket: sftpApi.serverTransferUsesProgressSocket,
  })
  const monitorApi = useMemo(
    () => createDesktopMonitorApi(desktopGateway),
    [desktopGateway],
  )
  const dockerApi = useMemo(() => createDesktopDockerApi(), [])
  const terminalSocket = useMemo(() => createDesktopTerminalSocket(), [])
  const runtimeInfo = useMemo(() => createDesktopRuntime(runtime), [runtime])
  const capabilities = useMemo(() => (
    createWorkspaceCapabilitiesFromRuntime(runtimeInfo, WORKSPACE_CAPABILITY_PRESETS.desktop)
  ), [runtimeInfo])
  const totalTabCount = sessions.length + sftpTabs.length
  const sftpTabSessions = useMemo(() => sftpTabs.map(createSftpTabSession), [sftpTabs])
  const visibleTerminalSessions = useMemo(() => (
    desktopTerminalTransportReady
      ? sessions
      : sessions.map((session) => (
        session.type === "terminal" && session.shouldConnect
          ? {
              ...session,
              shouldConnect: false,
              connectionPhase: "idle" as TerminalConnectionPhase,
            }
          : session
      ))
  ), [desktopTerminalTransportReady, sessions])
  const combinedSessionsRef = useRef<TerminalSession[]>([])
  combinedSessionsRef.current = [...sessions, ...sftpTabSessions]

  const workspaceApi = useMemo<SshWorkspaceApiClient>(() => ({
    sftp: {
      ...sftpApi,
      directTransfer: (
        sourceServerId: string,
        sourcePath: string,
        targetServerId: string,
        targetPath: string,
        options?: DirectTransferOptions,
      ) => {
        const sourceSession = combinedSessionsRef.current.find((session) => session.serverId === sourceServerId)
        const targetSession = combinedSessionsRef.current.find((session) => session.serverId === targetServerId)

        return sftpApi.directTransfer?.(sourceServerId, sourcePath, targetServerId, targetPath, {
          ...options,
          sourceServerName: options?.sourceServerName ?? sourceSession?.serverName ?? sourceServerId,
          sourceAuthMethod: options?.sourceAuthMethod ?? sourceSession?.authMethod ?? "password",
          targetServerName: options?.targetServerName ?? targetSession?.serverName ?? targetServerId,
          targetAuthMethod: options?.targetAuthMethod ?? targetSession?.authMethod ?? "password",
        }) ?? Promise.reject(new Error("SFTP direct transfer is unavailable"))
      },
    },
    monitor: monitorApi,
    docker: dockerApi,
    terminal: {
      ...(desktopTerminalGatewayReady || !runtimeLoaded ? {} : { WebSocketCtor: terminalSocket }),
      createWebSocketUrl: ({ serverId, cols, rows, ticket }) => {
        const params = new URLSearchParams()
        params.set("serverId", serverId)
        params.set("cols", String(cols))
        params.set("rows", String(rows))
        if (desktopTerminalGatewayReady) {
          params.set("ticket", ticket || desktopGatewayToken || "desktop")
          return `${desktopGatewayWsBaseUrl}/terminal?${params.toString()}`
        }
        if (!runtimeLoaded) {
          throw new Error("desktop terminal runtime is not ready")
        }
        return `desktop://terminal?${params.toString()}`
      },
      saveVerifiedCredential: async ({ serverId, authMethod, secret, password, privateKey }) => {
        await saveDesktopVerifiedCredential({ serverId, authMethod, secret, password, privateKey })
      },
    },
  }), [desktopGatewayToken, desktopGatewayWsBaseUrl, desktopTerminalGatewayReady, dockerApi, monitorApi, runtimeLoaded, sftpApi, terminalSocket])

  const handleLocaleChange = useCallback((nextLocale: Locale) => {
    if (nextLocale === locale) {
      return
    }

    saveLocaleToStorage(nextLocale)
    setLocale(nextLocale)
  }, [locale])

  const adapters = useMemo(() => createWorkspaceAdapters({
    apiClient: workspaceApi,
    authTicketProvider: async () => desktopGatewayToken ?? "desktop",
    i18n: createWorkspaceI18nAdapter({
      locale,
      timezone: "Asia/Shanghai",
      common: tCommon,
      terminal: tTerminal,
      sftp: tSftp,
      fallback: (key: string) => key,
    }),
    notifier: {
      success: (message) => toast.success(message),
      error: (message) => toast.error(message),
      action: (message, options) => toast(message, {
        description: options.description,
        action: {
          label: options.actionLabel,
          onClick: options.onAction,
        },
      }),
      promise: (promise, messages) => toast.promise(promise, messages),
    },
    settings: createWorkspaceSettingsAdapter({
      sftp: {
        downloadExcludePatterns: DEFAULT_SYSTEM_CONFIG.download_exclude_patterns,
      },
    }),
    preferences: workspacePreferences,
    transferManager: {
      tasks: fileTransfer.tasks,
      downloadFile: fileTransfer.downloadFile,
      batchDownload: fileTransfer.batchDownload,
      uploadFile: fileTransfer.uploadFile,
      directTransfer: fileTransfer.directTransfer,
      createTransferTask: fileTransfer.createTransferTask,
      addTask: fileTransfer.addTask,
      updateTask: fileTransfer.updateTask,
      removeTask: fileTransfer.removeTask,
      clearAll: fileTransfer.clearAll,
      clearCompleted: fileTransfer.clearCompleted,
      cancelTask: fileTransfer.cancelTask,
      cancelDirectTransfer: fileTransfer.cancelDirectTransfer,
      history: transferHistory,
    },
    activityLog,
    sessionStore: workspaceSessionStore,
    sessionController: workspaceSessionController,
  }), [
    activityLog,
    locale,
    tCommon,
    tSftp,
    tTerminal,
    workspaceApi,
    desktopGatewayToken,
    fileTransfer.addTask,
    fileTransfer.batchDownload,
    fileTransfer.cancelDirectTransfer,
    fileTransfer.cancelTask,
    fileTransfer.clearAll,
    fileTransfer.clearCompleted,
    fileTransfer.createTransferTask,
    fileTransfer.directTransfer,
    fileTransfer.downloadFile,
    fileTransfer.removeTask,
    fileTransfer.tasks,
    fileTransfer.updateTask,
    fileTransfer.uploadFile,
    transferHistory,
    workspacePreferences,
    workspaceSessionController,
    workspaceSessionStore,
  ])

  useEffect(() => {
    void i18n.changeLanguage(locale)
  }, [locale])

  useEffect(() => {
    let mounted = true

    loadDesktopRuntime()
      .then((runtimeInfo) => {
        if (mounted) {
          setRuntime(runtimeInfo)
        }
      })
      .catch((error) => {
        console.error("Failed to load desktop runtime:", error)
      })
      .finally(() => {
        if (mounted) {
          setRuntimeLoaded(true)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true

    loadDesktopPreferenceSnapshot()
      .then((snapshot) => {
        if (mounted) setPreferenceSnapshot(snapshot)
      })
      .catch((error) => {
        console.error("Failed to load desktop preferences:", error)
        if (mounted) setPreferenceSnapshot({})
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    if (sessions.length === 0) {
      const session = createConfigSession(connectionConfigName)
      setSessions([session])
      setActiveSessionId(session.id)
      updateSessionActivity(session.id, session.lastActivity)
      return
    }

    if (!activeSessionId || !sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0]?.id ?? null)
    }
  }, [activeSessionId, connectionConfigName, sessions, setActiveSessionId, setSessions, updateSessionActivity])

  useEffect(() => {
    setSessions((current) => current.map((session) => (
      session.type === "config" && session.serverName !== connectionConfigName
        ? { ...session, serverName: connectionConfigName }
        : session
    )))
  }, [connectionConfigName, setSessions])

  const resetToConfigSession = useCallback(() => {
    const session = createConfigSession(connectionConfigName, `config-${Date.now()}`)
    setSessions([session])
    setActiveSessionId(session.id)
    updateSessionActivity(session.id, session.lastActivity)
  }, [connectionConfigName, setActiveSessionId, setSessions, updateSessionActivity])

  const handleNewSession = useCallback(() => {
    if (totalTabCount >= maxTabs) {
      toast.error(tTerminal("errorMaxTabsReached", { max: maxTabs }))
      return
    }

    const session = createConfigSession(connectionConfigName, `config-${Date.now()}`)
    setSessions((current) => [...current, session])
    setActiveSessionId(session.id)
    updateSessionActivity(session.id, session.lastActivity)
    return session.id
  }, [connectionConfigName, maxTabs, setActiveSessionId, setSessions, tTerminal, totalTabCount, updateSessionActivity])

  const handleOpenSftpPicker = useCallback(() => {
    if (totalTabCount >= maxTabs) {
      toast.error(tTerminal("errorMaxTabsReached", { max: maxTabs }))
      return
    }

    setSftpPickerOpen(true)
  }, [maxTabs, tTerminal, totalTabCount])

  const handleCreateSftpTabFromServer = useCallback((server: Server): boolean => {
    if (totalTabCount >= maxTabs) {
      toast.error(tTerminal("errorMaxTabsReached", { max: maxTabs }))
      return false
    }

    const now = Date.now()
    const id = createSftpTabId()
    setSftpTabs((current) => [
      ...current,
      {
        id,
        label: getServerDisplayName(server),
        server,
        createdAt: now,
      },
    ])
    setActiveSftpTabId(id)
    return true
  }, [maxTabs, tTerminal, totalTabCount])

  const handleCloseSftpTab = useCallback((tabId: string) => {
    setSftpTabs((current) => current.filter((tab) => tab.id !== tabId))
    setActiveSftpTabId((current) => current === tabId ? null : current)
  }, [])

  const handleReorderSftpTabs = useCallback((newOrderIds: string[]) => {
    setSftpTabs((current) => {
      const tabMap = new Map(current.map((tab) => [tab.id, tab]))
      const ordered = newOrderIds
        .map((id) => tabMap.get(id))
        .filter((tab): tab is DesktopSftpTab => Boolean(tab))
      const orderedIds = new Set(ordered.map((tab) => tab.id))
      const remaining = current.filter((tab) => !orderedIds.has(tab.id))

      return [...ordered, ...remaining]
    })
  }, [])

  const handleRenameSftpTab = useCallback((tabId: string, label: string) => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return

    setSftpTabs((current) => current.map((tab) => (
      tab.id === tabId ? { ...tab, label: trimmedLabel } : tab
    )))
  }, [])

  const handleStartConnectionFromConfig = useCallback((sessionId: string, server: Server) => {
    const now = Date.now()

    startTransition(() => {
      setSessions((current) => current.map((session) => (
        session.id === sessionId
          ? createTerminalSessionFromServer(sessionId, server, now)
          : session
      )))
      setActiveSessionId(sessionId)
      updateSessionActivity(sessionId, now)
    })

    void markDesktopServerConnected(server.id)
      .catch((error) => console.error("Failed to mark desktop server connected:", error))
    void recordDesktopTerminalOpened(server)
      .catch((error) => console.error("Failed to record desktop connection activity:", error))
  }, [setActiveSessionId, setSessions, updateSessionActivity])

  const handleCloseSession = useCallback((sessionId: string) => {
    if (sessions.length <= 1) {
      if (sessions[0]?.type === "config") {
        setActiveSessionId(sessions[0].id)
        return
      }
      resetToConfigSession()
      return
    }

    const currentIndex = sessions.findIndex((session) => session.id === sessionId)
    if (activeSessionId === sessionId && currentIndex !== -1) {
      const nextIndex = currentIndex < sessions.length - 1 ? currentIndex + 1 : currentIndex - 1
      setActiveSessionId(sessions[nextIndex]?.id ?? null)
    }

    setSessions((current) => current.filter((session) => session.id !== sessionId))
  }, [activeSessionId, resetToConfigSession, sessions, setActiveSessionId, setSessions])

  const handleCloseSessions = useCallback((sessionIds: string[]) => {
    const closing = new Set(sessionIds)
    const remaining = sessions.filter((session) => !closing.has(session.id))
    if (remaining.length === 0) {
      resetToConfigSession()
      return
    }
    if (activeSessionId && closing.has(activeSessionId)) {
      setActiveSessionId(remaining[0]?.id ?? null)
    }
    setSessions(remaining)
  }, [activeSessionId, resetToConfigSession, sessions, setActiveSessionId, setSessions])

  const handleDuplicateSession = useCallback((sessionId: string) => {
    const source = sessions.find((session) => session.id === sessionId)
    if (!source) return
    if (totalTabCount >= maxTabs) {
      toast.error(tTerminal("errorMaxTabsReached", { max: maxTabs }))
      return
    }

    const now = Date.now()
    const duplicate: TerminalSession = {
      ...source,
      id: `session-${now}`,
      lastActivity: now,
      pinned: false,
      connectionPhase: source.type === "terminal" ? "idle" : source.connectionPhase,
      status: source.type === "terminal" ? "reconnecting" : source.status,
    }

    setSessions((current) => [...current, duplicate])
    setActiveSessionId(duplicate.id)
    updateSessionActivity(duplicate.id, now)
  }, [maxTabs, sessions, setActiveSessionId, setSessions, tTerminal, totalTabCount, updateSessionActivity])

  const handleCloseOthers = useCallback((sessionId: string) => {
    setSessions((current) => current.filter((session) => session.id === sessionId || session.pinned))
    setActiveSessionId(sessionId)
  }, [setActiveSessionId, setSessions])

  const handleCloseAll = useCallback(() => {
    const pinned = sessions.filter((session) => session.pinned)
    if (pinned.length === 0) {
      resetToConfigSession()
      return
    }
    setSessions(pinned)
    setActiveSessionId(pinned[0].id)
  }, [resetToConfigSession, sessions, setActiveSessionId, setSessions])

  const handleTogglePin = useCallback((sessionId: string) => {
    setSessions((current) => current.map((session) => (
      session.id === sessionId
        ? { ...session, pinned: !session.pinned }
        : session
    )))
  }, [setSessions])

  const handleReorder = useCallback((newOrderIds: string[]) => {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]))
    const next = newOrderIds.map((id) => sessionMap.get(id)).filter((session): session is TerminalSession => !!session)
    if (next.length === sessions.length) {
      setSessions(next)
    }
  }, [sessions, setSessions])

  const handleSendCommand = useCallback((sessionId: string, command: string) => {
    if (command.trim()) {
      updateSessionActivity(sessionId)
      inactivityNotifiedRef.current.delete(sessionId)
    }
  }, [updateSessionActivity])

  const handleConnectionPhaseChange = useCallback((sessionId: string, phase: TerminalConnectionPhase) => {
    setSessions((current) => current.map((session) => (
      session.id === sessionId
        ? {
            ...session,
            connectionPhase: phase,
            status: statusFromConnectionPhase(phase),
          }
        : session
    )))
    if (phase === "ready") {
      updateSessionActivity(sessionId)
    }
  }, [setSessions, updateSessionActivity])

  const renderSftpTabContent = useCallback((session: TerminalSession, options?: TerminalExtraSessionRenderOptions) => {
    const tab = sftpTabs.find((item) => item.id === session.id)
    if (!tab) return null

    return (
      <TerminalSftpTabContent
        sessionId={tab.id}
        server={tab.server}
        label={tab.label}
        chrome={options?.chrome}
        surface={options?.surface}
        onPathChange={options?.onPathChange}
        refreshRequestVersion={options?.refreshRequestVersion}
        initialPath={options?.initialPath}
        initialPathBackStack={options?.initialPathBackStack}
        initialPathForwardStack={options?.initialPathForwardStack}
        onHistoryChange={options?.onHistoryChange}
        onClose={() => handleCloseSftpTab(tab.id)}
        onRenameSession={(label) => handleRenameSftpTab(tab.id, label)}
      />
    )
  }, [handleCloseSftpTab, handleRenameSftpTab, sftpTabs])

  const handleAuthCancelled = useCallback((sessionId: string) => {
    const now = Date.now()
    useTerminalStore.getState().destroySession(sessionId)
    setSessions((current) => current.map((session) => (
      session.id === sessionId
        ? { ...createConfigSession(connectionConfigName, sessionId), lastActivity: now }
        : session
    )))
    updateSessionActivity(sessionId, now)
  }, [connectionConfigName, setSessions, updateSessionActivity])

  const handleToggleAiAssistant = useCallback(() => {
    setAiAssistantMounted(true)
    setActiveView((current) => (current === "ai" ? "terminal" : "ai"))
  }, [])

  const handleOpenScripts = useCallback(() => {
    setScriptsMounted(true)
    setActiveView("scripts")
  }, [])

  const handleOpenActivityLogs = useCallback(() => {
    setActivityLogsMounted(true)
    setActiveView("activity-logs")
  }, [])

  const handleOpenBackupRestore = useCallback(() => {
    setBackupRestoreMounted(true)
    setActiveView("backup-restore")
  }, [])

  const handleReturnToTerminal = useCallback(() => {
    setActiveView("terminal")
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      const threshold = inactiveMinutes * 60 * 1000

      sessions.forEach((session) => {
        if (!shouldCheckTerminalInactivity(session)) {
          inactivityNotifiedRef.current.delete(session.id)
          return
        }

        const lastActivity = getSessionLastActivity(session.id) ?? session.lastActivity
        if (now - lastActivity < threshold || inactivityNotifiedRef.current.has(session.id)) {
          return
        }
        inactivityNotifiedRef.current.add(session.id)
        toast(tTerminal("inactiveToastTitle", { name: session.serverName }), {
          description: tTerminal("inactiveToastDescription", { minutes: inactiveMinutes }),
          action: {
            label: tTerminal("inactiveToastActionLabel"),
            onClick: () => handleCloseSession(session.id),
          },
        })
      })
    }, 60 * 1000)

    return () => window.clearInterval(timer)
  }, [getSessionLastActivity, handleCloseSession, inactiveMinutes, sessions, tTerminal])

  if (preferenceSnapshot === null) {
    return (
      <DesktopProviders>
        <main className="flex h-full w-full min-h-0 min-w-0 isolate flex-col overflow-hidden bg-background text-foreground">
          <DesktopTitleBar
            runtime={runtime}
            activeView={activeView}
            locale={locale}
            onToggleAiAssistant={handleToggleAiAssistant}
            onLocaleChange={handleLocaleChange}
            onOpenScripts={handleOpenScripts}
            onOpenActivityLogs={handleOpenActivityLogs}
            onOpenBackupRestore={handleOpenBackupRestore}
          />
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </div>
        </main>
        <DesktopUpdateFailureDialog />
      </DesktopProviders>
    )
  }

  return (
    <DesktopProviders>
      <SshWorkspace adapters={adapters} capabilities={capabilities} layout="desktop">
        <main className="flex h-full w-full min-h-0 min-w-0 isolate flex-col overflow-hidden bg-background text-foreground">
          <DesktopTitleBar
            runtime={runtime}
            activeView={activeView}
            locale={locale}
            onToggleAiAssistant={handleToggleAiAssistant}
            onLocaleChange={handleLocaleChange}
            onOpenScripts={handleOpenScripts}
            onOpenActivityLogs={handleOpenActivityLogs}
            onOpenBackupRestore={handleOpenBackupRestore}
          />
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <section
              className="pointer-events-none invisible absolute inset-0 flex min-h-0 min-w-0 overflow-hidden opacity-0 data-[active=true]:pointer-events-auto data-[active=true]:visible data-[active=true]:opacity-100"
              data-active={activeView === "terminal"}
              aria-hidden={activeView !== "terminal"}
            >
              <SftpServerPickerDialog
                open={sftpPickerOpen}
                ready
                serverApi={serverApi}
                onOpenChange={setSftpPickerOpen}
                onSelect={handleCreateSftpTabFromServer}
              />
              <TerminalComponent
                sessions={visibleTerminalSessions}
                onNewSession={handleNewSession}
                extraSessions={sftpTabSessions}
                extraNewSessionActions={[{
                  id: "new-desktop-sftp-session",
                  label: "SFTP+",
                  ariaLabel: tTerminal("sftpPickerActionLabel"),
                  title: tTerminal("sftpPickerActionLabel"),
                  onCreate: handleOpenSftpPicker,
                }]}
                renderExtraSessionContent={renderSftpTabContent}
                onCloseExtraSession={handleCloseSftpTab}
                onReorderExtraSessions={handleReorderSftpTabs}
                externalActiveExtraSessionId={activeSftpTabId}
                onActiveExtraSessionChange={setActiveSftpTabId}
                onCloseSession={handleCloseSession}
                onCloseSessions={handleCloseSessions}
                onSendCommand={handleSendCommand}
                onDuplicateSession={handleDuplicateSession}
                onCloseOthers={handleCloseOthers}
                onCloseAll={handleCloseAll}
                onTogglePin={handleTogglePin}
                onReorderSessions={handleReorder}
                onStartConnectionFromConfig={handleStartConnectionFromConfig}
                onAuthCancelled={handleAuthCancelled}
                externalActiveSessionId={activeSessionId}
                onActiveSessionChange={setActiveSessionId}
                onConnectionPhaseChange={handleConnectionPhaseChange}
                onBehaviorSettingsChange={({ maxTabs, inactiveMinutes }) => {
                  setMaxTabs(Math.max(1, Math.min(maxTabs, defaultMaxTabs)))
                  setInactiveMinutes(Math.max(5, Math.min(inactiveMinutes, defaultInactiveMinutes)))
                }}
                serverApi={serverApi}
                serverConfigsReady
                aiAssistantAdapters={aiAssistantAdapters}
                hidePageHeader
                unframed
                settingsDialogOpen={terminalSettingsOpen}
                onSettingsDialogOpenChange={setTerminalSettingsOpen}
              />
            </section>
            <section
              className="pointer-events-none invisible absolute inset-0 flex min-h-0 min-w-0 overflow-hidden opacity-0 data-[active=true]:pointer-events-auto data-[active=true]:visible data-[active=true]:opacity-100"
              data-active={activeView === "ai"}
              aria-hidden={activeView !== "ai"}
            >
              {aiAssistantMounted ? (
                <DesktopAIAssistantView
                  adapters={aiAssistantAdapters}
                  locale={locale}
                  onReturnToTerminal={handleReturnToTerminal}
                />
              ) : null}
            </section>
            <section
              className="pointer-events-none invisible absolute inset-0 flex min-h-0 min-w-0 overflow-hidden opacity-0 data-[active=true]:pointer-events-auto data-[active=true]:visible data-[active=true]:opacity-100"
              data-active={activeView === "scripts"}
              aria-hidden={activeView !== "scripts"}
            >
              {scriptsMounted ? (
                <DesktopScriptsView
                  adapters={scriptAdapters}
                  locale={locale}
                  onReturnToTerminal={handleReturnToTerminal}
                />
              ) : null}
            </section>
            <section
              className="pointer-events-none invisible absolute inset-0 flex min-h-0 min-w-0 overflow-hidden opacity-0 data-[active=true]:pointer-events-auto data-[active=true]:visible data-[active=true]:opacity-100"
              data-active={activeView === "activity-logs"}
              aria-hidden={activeView !== "activity-logs"}
            >
              {activityLogsMounted ? (
                <DesktopActivityLogsView
                  locale={locale}
                  onReturnToTerminal={handleReturnToTerminal}
                />
              ) : null}
            </section>
            <section
              className="pointer-events-none invisible absolute inset-0 flex min-h-0 min-w-0 overflow-hidden opacity-0 data-[active=true]:pointer-events-auto data-[active=true]:visible data-[active=true]:opacity-100"
              data-active={activeView === "backup-restore"}
              aria-hidden={activeView !== "backup-restore"}
            >
              {backupRestoreMounted ? (
                <DesktopBackupRestoreView
                  locale={locale}
                  onReturnToTerminal={handleReturnToTerminal}
                />
              ) : null}
            </section>
          </div>
        </main>
        <DesktopUpdateFailureDialog />
      </SshWorkspace>
    </DesktopProviders>
  )
}

export default App
