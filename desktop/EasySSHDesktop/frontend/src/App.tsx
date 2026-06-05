import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_SYSTEM_CONFIG,
  SshWorkspace,
  TerminalComponent,
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
  type SshWorkspaceApiClient,
  type TerminalConnectionPhase,
  type TerminalSession,
} from "@easyssh/ssh-workspace/desktop"
import { createDesktopActivityLogAdapter, recordDesktopTerminalOpened } from "./adapters/desktop-activity-log-adapter"
import { createDesktopAIAssistantAdapters } from "./adapters/desktop-ai-adapters"
import { createDesktopPreferenceAdapter, loadDesktopPreferenceSnapshot, type DesktopPreferenceSnapshot } from "./adapters/desktop-preferences"
import { createDesktopRuntime, loadDesktopRuntime, type DesktopRuntimeBindingInfo } from "./adapters/desktop-runtime"
import { createDesktopServerApi, markDesktopServerConnected, saveDesktopVerifiedCredential } from "./adapters/desktop-server-api"
import { DesktopAIAssistantView } from "./shell/desktop-ai-assistant-view"
import { DesktopProviders } from "./shell/desktop-providers"
import { DesktopTitleBar, type DesktopView } from "./shell/desktop-titlebar"
import { createDesktopTerminalSocket } from "./terminal/desktop-terminal-socket"

const connectionConfigName = "\u8fde\u63a5\u914d\u7f6e"
const defaultMaxTabs = 50
const defaultInactiveMinutes = 60
const desktopLoadingLabel = "\u52a0\u8f7d\u4e2d..."
const inactiveToastTitle = "\u7ec8\u7aef\u957f\u65f6\u95f4\u672a\u6d3b\u52a8"
const inactiveToastCloseLabel = "\u5173\u95ed"

function formatMaxTabsMessage(maxTabs: number) {
  return `\u6700\u591a\u53ea\u80fd\u6253\u5f00 ${maxTabs} \u4e2a\u6807\u7b7e`
}

function formatInactiveToastDescription(sessionName: string, inactiveMinutes: number) {
  return `${sessionName} \u5df2\u8d85\u8fc7 ${inactiveMinutes} \u5206\u949f\u672a\u6d3b\u52a8`
}

function statusFromConnectionPhase(phase: TerminalConnectionPhase) {
  if (phase === "ready") return "connected" as const
  if (phase === "failed" || phase === "closed" || phase === "idle") return "disconnected" as const
  return "reconnecting" as const
}

function createConfigSession(id = "config-initial"): TerminalSession {
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

function App() {
  const [runtime, setRuntime] = useState<DesktopRuntimeBindingInfo | null>(null)
  const [preferenceSnapshot, setPreferenceSnapshot] = useState<DesktopPreferenceSnapshot | null>(null)
  const [activeView, setActiveView] = useState<DesktopView>("terminal")
  const [aiAssistantMounted, setAiAssistantMounted] = useState(false)
  const [maxTabs, setMaxTabs] = useState(defaultMaxTabs)
  const [inactiveMinutes, setInactiveMinutes] = useState(defaultInactiveMinutes)
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false)
  const inactivityNotifiedRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)

  const sessions = useTerminalStore((state) => state.sessions)
  const activeSessionId = useTerminalStore((state) => state.activeSessionId)
  const setSessions = useTerminalStore((state) => state.setSessions)
  const setActiveSessionId = useTerminalStore((state) => state.setActiveSessionId)
  const updateSessionActivity = useTerminalStore((state) => state.updateSessionActivity)
  const getSessionLastActivity = useTerminalStore((state) => state.getSessionLastActivity)

  const serverApi = useMemo(() => createDesktopServerApi(), [])
  const aiAssistantAdapters = useMemo(() => createDesktopAIAssistantAdapters(serverApi), [serverApi])
  const activityLog = useMemo(() => createDesktopActivityLogAdapter(), [])
  const workspaceSessionStore = useMemo(() => createTerminalWorkspaceSessionStoreAdapter(), [])
  const workspaceSessionController = useMemo(() => createTerminalWorkspaceSessionControllerAdapter(), [])
  const workspacePreferences = useMemo(() => createDesktopPreferenceAdapter(preferenceSnapshot ?? {}), [preferenceSnapshot])
  const terminalSocket = useMemo(() => createDesktopTerminalSocket(), [])
  const runtimeInfo = useMemo(() => createDesktopRuntime(runtime), [runtime])
  const capabilities = useMemo(() => (
    createWorkspaceCapabilitiesFromRuntime(runtimeInfo, WORKSPACE_CAPABILITY_PRESETS.desktop)
  ), [runtimeInfo])

  const workspaceApi = useMemo<SshWorkspaceApiClient>(() => ({
    terminal: {
      WebSocketCtor: terminalSocket,
      createWebSocketUrl: ({ serverId, cols, rows }) => {
        const params = new URLSearchParams()
        params.set("serverId", serverId)
        params.set("cols", String(cols))
        params.set("rows", String(rows))
        return `desktop://terminal?${params.toString()}`
      },
      saveVerifiedCredential: async ({ serverId, authMethod, secret }) => {
        await saveDesktopVerifiedCredential({ serverId, authMethod, secret })
      },
    },
  }), [terminalSocket])

  const adapters = useMemo(() => createWorkspaceAdapters({
    apiClient: workspaceApi,
    authTicketProvider: async () => "desktop",
    i18n: createWorkspaceI18nAdapter({
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
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
    activityLog,
    sessionStore: workspaceSessionStore,
    sessionController: workspaceSessionController,
  }), [activityLog, workspaceApi, workspacePreferences, workspaceSessionController, workspaceSessionStore])

  useEffect(() => {
    loadDesktopRuntime()
      .then(setRuntime)
      .catch((error) => {
        console.error("Failed to load desktop runtime:", error)
      })
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
      const session = createConfigSession()
      setSessions([session])
      setActiveSessionId(session.id)
      updateSessionActivity(session.id, session.lastActivity)
      return
    }

    if (!activeSessionId || !sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0]?.id ?? null)
    }
  }, [activeSessionId, sessions, setActiveSessionId, setSessions, updateSessionActivity])

  const resetToConfigSession = useCallback(() => {
    const session = createConfigSession(`config-${Date.now()}`)
    setSessions([session])
    setActiveSessionId(session.id)
    updateSessionActivity(session.id, session.lastActivity)
  }, [setActiveSessionId, setSessions, updateSessionActivity])

  const handleNewSession = useCallback(() => {
    if (sessions.length >= maxTabs) {
      toast.error(formatMaxTabsMessage(maxTabs))
      return
    }

    const session = createConfigSession(`config-${Date.now()}`)
    setSessions((current) => [...current, session])
    setActiveSessionId(session.id)
    updateSessionActivity(session.id, session.lastActivity)
    return session.id
  }, [maxTabs, sessions.length, setActiveSessionId, setSessions, updateSessionActivity])

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
    if (sessions.length >= maxTabs) {
      toast.error(formatMaxTabsMessage(maxTabs))
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
  }, [maxTabs, sessions, setActiveSessionId, setSessions, updateSessionActivity])

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

  const handleAuthCancelled = useCallback((sessionId: string) => {
    const now = Date.now()
    useTerminalStore.getState().destroySession(sessionId)
    setSessions((current) => current.map((session) => (
      session.id === sessionId
        ? { ...createConfigSession(sessionId), lastActivity: now }
        : session
    )))
    updateSessionActivity(sessionId, now)
  }, [setSessions, updateSessionActivity])

  const handleToggleAiAssistant = useCallback(() => {
    setAiAssistantMounted(true)
    setActiveView((current) => (current === "ai" ? "terminal" : "ai"))
  }, [])

  const handleReturnToTerminal = useCallback(() => {
    setActiveView("terminal")
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      const threshold = inactiveMinutes * 60 * 1000

      sessions.forEach((session) => {
        const lastActivity = getSessionLastActivity(session.id) ?? session.lastActivity
        if (now - lastActivity < threshold || inactivityNotifiedRef.current.has(session.id)) {
          return
        }
        inactivityNotifiedRef.current.add(session.id)
        toast(inactiveToastTitle, {
          description: formatInactiveToastDescription(session.serverName, inactiveMinutes),
          action: {
            label: inactiveToastCloseLabel,
            onClick: () => handleCloseSession(session.id),
          },
        })
      })
    }, 60 * 1000)

    return () => window.clearInterval(timer)
  }, [getSessionLastActivity, handleCloseSession, inactiveMinutes, sessions])

  if (preferenceSnapshot === null) {
    return (
      <DesktopProviders>
        <main className="easyssh-desktop-home bg-background text-foreground">
          <DesktopTitleBar
            runtime={runtime}
            activeView={activeView}
            onToggleAiAssistant={handleToggleAiAssistant}
            onOpenTerminalSettings={() => setTerminalSettingsOpen(true)}
          />
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            {desktopLoadingLabel}
          </div>
        </main>
      </DesktopProviders>
    )
  }

  return (
    <DesktopProviders>
      <SshWorkspace adapters={adapters} capabilities={capabilities} layout="desktop">
        <main className="easyssh-desktop-home bg-background text-foreground">
          <DesktopTitleBar
            runtime={runtime}
            activeView={activeView}
            onToggleAiAssistant={handleToggleAiAssistant}
            onOpenTerminalSettings={() => setTerminalSettingsOpen(true)}
          />
          <div className="easyssh-desktop-view-stack">
            <section
              className="easyssh-desktop-view-panel"
              data-active={activeView === "terminal"}
              aria-hidden={activeView !== "terminal"}
            >
              <TerminalComponent
                sessions={sessions}
                onNewSession={handleNewSession}
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
                hidePageHeader
                unframed
                settingsDialogOpen={terminalSettingsOpen}
                onSettingsDialogOpenChange={setTerminalSettingsOpen}
              />
            </section>
            <section
              className="easyssh-desktop-view-panel"
              data-active={activeView === "ai"}
              aria-hidden={activeView !== "ai"}
            >
              {aiAssistantMounted ? (
                <DesktopAIAssistantView
                  adapters={aiAssistantAdapters}
                  onReturnToTerminal={handleReturnToTerminal}
                />
              ) : null}
            </section>
          </div>
        </main>
      </SshWorkspace>
    </DesktopProviders>
  )
}

export default App
