
import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "@/components/ui/sonner"
import { SshWorkspace } from "@easyssh/ssh-workspace"
import { TerminalComponent, type TerminalExtraSessionRenderOptions } from "@/components/terminal/terminal-component"
import { TerminalSftpTabContent } from "@/components/terminal/terminal-sftp-tab-content"
import type { TerminalSettings } from "@/components/terminal/terminal-settings-dialog"
import type {
  TerminalSession,
  TerminalConnectionPhase,
} from "@/components/terminal/types"
import { SftpServerPickerDialog } from "@/components/sftp/sftp-server-picker-dialog"
import { serversApi, sftpApi, type Server } from "@/lib/api"
import { createAuthTicket } from "@/lib/auth-ticket"
import { createTerminalWorkspaceSessionControllerAdapter, createTerminalWorkspaceSessionStoreAdapter, useTerminalStore } from "@/stores/terminal-store"
import { createSftpSessionApi } from "@/lib/session/sftp-session-api"
import type { FileTransferDirectTransferOptions } from "@/lib/session/transfer-manager-controller"
import { createBrowserWorkspacePreferenceAdapter, createWorkspaceAdapters, createWorkspaceAuthTicketProviderAdapter, createWorkspaceI18nAdapter, createWorkspaceNotifierAdapter, createWorkspaceSettingsAdapter } from "@/lib/session/workspace-adapters"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useTranslation } from "react-i18next"
import { useSystemConfig } from "@/contexts/system-config-context"
import { WORKSPACE_CAPABILITY_PRESETS, createWorkspaceCapabilitiesFromRuntime, useRuntime } from "@/shell/runtime"
import { isViteDev } from "@/lib/vite-env"
import { getServerAuthMethod, useSftpAuthRetry } from "@/components/sftp/use-sftp-auth-retry"
import { useTerminalAuthFlowAdapters } from "@/components/terminal/use-terminal-auth-flow-adapters"
import { primaryCredentialMethod } from "@/lib/ssh-auth-methods"
import { ViewportWorkspaceTransition } from "@/components/viewport-workspace-transition"

const statusFromConnectionPhase = (phase: TerminalConnectionPhase) => {
  if (phase === "ready") return "connected" as const
  if (phase === "failed" || phase === "closed" || phase === "idle") return "disconnected" as const
  return "reconnecting" as const
}

const createTerminalSessionFromServer = (
  sessionId: string,
  server: Server,
  now: number = Date.now()
): TerminalSession => ({
  id: sessionId,
  serverId: String(server.id),
  authMethod: getServerAuthMethod(server),
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
})

type MergedSftpTab = {
  id: string
  label: string
  server: Server
  pinned: boolean
  initialPath: string
  connectionPhase: TerminalConnectionPhase
  createdAt: number
}

const createSftpTabId = () => (
  `sftp-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
)

const getServerDisplayName = (server: Server) => (
  server.name || `${server.username}@${server.host}:${server.port}`
)

const createSftpTabSession = (tab: MergedSftpTab): TerminalSession => {
  return {
    id: tab.id,
    currentPath: tab.initialPath,
    serverId: String(tab.server.id),
    authMethod: getServerAuthMethod(tab.server),
    serverName: tab.label,
    host: tab.server.host,
    port: tab.server.port,
    username: tab.server.username,
    shouldConnect: false,
    connectionPhase: tab.connectionPhase,
    status: statusFromConnectionPhase(tab.connectionPhase),
    lastActivity: tab.createdAt,
    group: tab.server.group,
    tags: tab.server.tags,
    pinned: tab.pinned,
    type: "sftp",
  }
}

const shouldCheckTerminalInactivity = (session: TerminalSession) => (
  session.type === "terminal" &&
  !!session.serverId &&
  session.connectionPhase === "ready" &&
  session.status === "connected"
)

const readTerminalBehaviorSettings = (defaults: { maxTabs: number; inactiveMinutes: number }) => {
  if (typeof window === "undefined") {
    return defaults
  }

  try {
    const saved = localStorage.getItem("terminal-settings")
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<TerminalSettings>
      return {
        maxTabs:
          typeof parsed.maxTabs === "number" && Number.isFinite(parsed.maxTabs)
            ? parsed.maxTabs
            : defaults.maxTabs,
        inactiveMinutes:
          typeof parsed.inactiveMinutes === "number" && Number.isFinite(parsed.inactiveMinutes)
            ? parsed.inactiveMinutes
            : defaults.inactiveMinutes,
      }
    }

    const legacyMaxTabs = Number(localStorage.getItem("tab.maxTabs") || defaults.maxTabs)
    const legacyInactiveMinutes = Number(
      localStorage.getItem("tab.inactiveMinutes") || defaults.inactiveMinutes
    )

    return {
      maxTabs: Number.isFinite(legacyMaxTabs) ? legacyMaxTabs : defaults.maxTabs,
      inactiveMinutes: Number.isFinite(legacyInactiveMinutes)
        ? legacyInactiveMinutes
        : defaults.inactiveMinutes,
    }
  } catch {
    return defaults
  }
}

function TerminalPageContent() {
  const { ready } = useAuthReady()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { config: systemConfig } = useSystemConfig()
  const { runtime } = useRuntime()
  const { t: tCommon } = useTranslation("common")
  const { t } = useTranslation("terminal")
  const { t: tServers } = useTranslation("servers")
  const { t: tSftp } = useTranslation("sftp")
  const [maxTabs, setMaxTabs] = useState(50)
  const [inactiveMinutes, setInactiveMinutes] = useState(60)
  const inactivityNotifiedRef = useRef<Set<string>>(new Set())
  const consumedServerIdRef = useRef<string | null>(null)
  const consumedSftpOpenRef = useRef(false)
  const serverIdFromSearch = searchParams.get("serverId")?.trim() ?? ""
  const shouldOpenSftpFromSearch = searchParams.get("sftpPicker") === "1"

  const sessions = useTerminalStore((state) => state.sessions)
  const activeSessionId = useTerminalStore((state) => state.activeSessionId)
  const setSessions = useTerminalStore((state) => state.setSessions)
  const setActiveSessionId = useTerminalStore((state) => state.setActiveSessionId)
  const updateSessionActivity = useTerminalStore((state) => state.updateSessionActivity)
  const getSessionLastActivity = useTerminalStore((state) => state.getSessionLastActivity)
  const [sftpTabs, setSftpTabs] = useState<MergedSftpTab[]>([])
  const [activeSftpTabId, setActiveSftpTabId] = useState<string | null>(null)
  const [sftpPickerOpen, setSftpPickerOpen] = useState(false)
  const workspaceSessionStore = useMemo(() => createTerminalWorkspaceSessionStoreAdapter(), [])
  const workspaceSessionController = useMemo(() => createTerminalWorkspaceSessionControllerAdapter(), [])
  const workspaceAuthTicketProvider = useMemo(() => createWorkspaceAuthTicketProviderAdapter(createAuthTicket), [])
  const sftpAuthFlowAdapters = useTerminalAuthFlowAdapters({})
  const { credentialDialog, runDirectTransferWithCredentialRetry } = useSftpAuthRetry({
    tTerminal: t,
    adapters: sftpAuthFlowAdapters,
  })
  const combinedSessionsRef = useRef<TerminalSession[]>([])
  const sftpSessionApi = useMemo(() => {
    const baseSftpSessionApi = createSftpSessionApi(sftpApi)
    const workspaceApi = {
      ...sftpApi,
      directTransfer: (
        sourceServerId: string,
        sourcePath: string,
        targetServerId: string,
        targetPath: string,
        options?: FileTransferDirectTransferOptions,
      ) => {
        const sourceSession = combinedSessionsRef.current.find((session) => session.serverId === sourceServerId)
        const targetSession = combinedSessionsRef.current.find((session) => session.serverId === targetServerId)

        return runDirectTransferWithCredentialRetry({
          sourceServerId,
          sourcePath,
          sourceServerName: options?.sourceServerName ?? sourceSession?.serverName ?? sourceServerId,
          sourceAuthMethod: options?.sourceAuthMethod ?? sourceSession?.authMethod ?? "password",
          targetServerId,
          targetPath,
          targetServerName: options?.targetServerName ?? targetSession?.serverName ?? targetServerId,
          targetAuthMethod: options?.targetAuthMethod ?? targetSession?.authMethod ?? "password",
          api: baseSftpSessionApi,
          operation: (credentialOptions) => sftpApi.directTransfer(
            sourceServerId,
            sourcePath,
            targetServerId,
            targetPath,
            credentialOptions,
          ),
        })
      },
    }

    return createSftpSessionApi(workspaceApi)
  }, [runDirectTransferWithCredentialRetry])
  const workspacePreferences = useMemo(() => createBrowserWorkspacePreferenceAdapter(), [])
  const workspaceAdapters = useMemo(() => createWorkspaceAdapters({
    apiClient: {
      sftp: sftpSessionApi,
      terminal: {
          saveVerifiedCredential: ({ serverId, authMethod, secret, password, privateKey }) => {
            const payload = {
              auth_method: authMethod,
              verified_connection_credential: true,
              ...(password !== undefined ? { password } : {}),
              ...(privateKey !== undefined ? { private_key: privateKey } : {}),
              ...(password === undefined && privateKey === undefined
                ? primaryCredentialMethod(authMethod) === "key"
                  ? { private_key: secret }
                  : { password: secret }
                : {}),
            }

          return serversApi.update(serverId, payload)
        },
      },
    },
    i18n: createWorkspaceI18nAdapter({
      common: tCommon,
      terminal: t,
      sftp: tSftp,
    }),
    notifier: createWorkspaceNotifierAdapter(toast),
    settings: createWorkspaceSettingsAdapter({
      sftp: {
        downloadExcludePatterns: systemConfig?.download_exclude_patterns,
      },
    }),
    preferences: workspacePreferences,
    authTicketProvider: workspaceAuthTicketProvider,
    sessionStore: workspaceSessionStore,
    sessionController: workspaceSessionController,
  }), [tCommon, t, tSftp, systemConfig?.download_exclude_patterns, sftpSessionApi, workspaceAuthTicketProvider, workspacePreferences, workspaceSessionController, workspaceSessionStore])
  const workspaceCapabilities = useMemo(() => (
    createWorkspaceCapabilitiesFromRuntime(runtime, WORKSPACE_CAPABILITY_PRESETS.webTerminal)
  ), [runtime])
  const canUseSftpCapability = workspaceCapabilities.sftp !== false
  const tabPolicyMaxTabs = systemConfig?.tab_session?.max_tabs ?? 50
  const tabPolicyInactiveMinutes = systemConfig?.tab_session?.inactive_minutes ?? 60
  const totalTabCount = sessions.length + sftpTabs.length
  const sftpTabSessions = useMemo(
    () => sftpTabs.map(createSftpTabSession),
    [sftpTabs]
  )
  combinedSessionsRef.current = [...sessions, ...sftpTabSessions]

  const applyTerminalBehaviorSettings = useCallback(
    (settings: { maxTabs: number; inactiveMinutes: number }) => {
      setMaxTabs(Math.max(1, Math.min(settings.maxTabs, tabPolicyMaxTabs)))
      setInactiveMinutes(Math.max(5, Math.min(settings.inactiveMinutes, tabPolicyInactiveMinutes)))
    },
    [tabPolicyMaxTabs, tabPolicyInactiveMinutes]
  )

  // 读取终端行为设置，和终端设置弹窗使用同一个 localStorage key。
  useEffect(() => {
    const loadSettings = () => {
      const settings = readTerminalBehaviorSettings({
        maxTabs: tabPolicyMaxTabs,
        inactiveMinutes: tabPolicyInactiveMinutes,
      })
      applyTerminalBehaviorSettings(settings)
    }

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      requestIdleCallback(loadSettings)
    } else {
      setTimeout(loadSettings, 0)
    }
  }, [applyTerminalBehaviorSettings, tabPolicyInactiveMinutes, tabPolicyMaxTabs])

  const handleOpenSftpPicker = useCallback(() => {
    if (!canUseSftpCapability) {
      return
    }
    if (totalTabCount >= maxTabs) {
      toast.error(t("errorMaxTabsReached", { max: maxTabs }))
      return
    }

    setSftpPickerOpen(true)
  }, [canUseSftpCapability, maxTabs, t, totalTabCount])

  const handleCreateSftpTabFromServer = useCallback((server: Server, initialPath = "~"): boolean => {
    if (!canUseSftpCapability) {
      return false
    }
    if (totalTabCount >= maxTabs) {
      toast.error(t("errorMaxTabsReached", { max: maxTabs }))
      return false
    }

    const now = Date.now()
    const id = createSftpTabId()
    setSftpTabs((prev) => [
      ...prev,
      {
        id,
        label: getServerDisplayName(server),
        server,
        createdAt: now,
        pinned: false,
        initialPath,
        connectionPhase: "ssh_connecting",
      },
    ])
    setActiveSftpTabId(id)
    return true
  }, [canUseSftpCapability, maxTabs, t, totalTabCount])

  const handleCloseSftpTab = useCallback((tabId: string) => {
    setSftpTabs((prev) => prev.filter((tab) => tab.id !== tabId))
    setActiveSftpTabId((current) => current === tabId ? null : current)
  }, [])

  const handleReorderSftpTabs = useCallback((newOrderIds: string[]) => {
    setSftpTabs((current) => {
      const map = new Map(current.map((tab) => [tab.id, tab]))
      const ordered = newOrderIds
        .map((id) => map.get(id))
        .filter((tab): tab is MergedSftpTab => Boolean(tab))
      const orderedIds = new Set(ordered.map((tab) => tab.id))
      const remaining = current.filter((tab) => !orderedIds.has(tab.id))

      return [...ordered, ...remaining]
    })
  }, [])

  const handleRenameSftpTab = useCallback((tabId: string, label: string) => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return

    setSftpTabs((prev) => prev.map((tab) => (
      tab.id === tabId ? { ...tab, label: trimmedLabel } : tab
    )))
  }, [])

  useEffect(() => {
    if (!shouldOpenSftpFromSearch) {
      consumedSftpOpenRef.current = false
      return
    }
    if (!ready || consumedSftpOpenRef.current) return

    consumedSftpOpenRef.current = true
    if (canUseSftpCapability) {
      handleOpenSftpPicker()
    }
    setTimeout(() => {
      const url = new URL(window.location.href)
      url.searchParams.delete("sftpPicker")
      navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true })
    }, 0)
  }, [canUseSftpCapability, handleOpenSftpPicker, navigate, ready, shouldOpenSftpFromSearch])

  const handleStartConnection = useCallback((server: Server): string | void => {
    if (useTerminalStore.getState().sessions.length + sftpTabs.length >= maxTabs) {
      toast.error(t("errorMaxTabsReached", { max: maxTabs }))
      return
    }

    const now = Date.now()
    const sessionId = `session-${now}-${Math.random().toString(36).slice(2, 10)}`
    setSessions((prev) => [...prev, createTerminalSessionFromServer(sessionId, server, now)])
    setActiveSftpTabId(null)
    setActiveSessionId(sessionId)
    updateSessionActivity(sessionId, now)
    return sessionId
  }, [maxTabs, sftpTabs.length, setActiveSessionId, setSessions, t, updateSessionActivity])
  const startConnectionRef = useRef(handleStartConnection)
  startConnectionRef.current = handleStartConnection

  useEffect(() => {
    if (!serverIdFromSearch) {
      consumedServerIdRef.current = null
    }
  }, [serverIdFromSearch])

  useEffect(() => {
    if (!ready || !serverIdFromSearch) {
      return
    }
    if (consumedServerIdRef.current === serverIdFromSearch) {
      return
    }

    consumedServerIdRef.current = serverIdFromSearch
    let cancelled = false

    const cleanSearchParam = () => {
      if (typeof window === "undefined") {
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete("serverId")
      navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true })
    }

    const connectFromSearch = async () => {
      try {
        const server = await serversApi.getById(serverIdFromSearch)
        if (cancelled) {
          return
        }

        startConnectionRef.current(server)
        cleanSearchParam()
      } catch (error) {
        if (cancelled) return
        consumedServerIdRef.current = null
        console.error("Failed to connect server from quick access:", error)
        toast.error(tServers("toastLoadFailed"))
        cleanSearchParam()
      }
    }

    void connectFromSearch()

    return () => {
      cancelled = true
      if (consumedServerIdRef.current === serverIdFromSearch) {
        consumedServerIdRef.current = null
      }
    }
  }, [ready, navigate, serverIdFromSearch, tServers])

  const handleCloseSession = useCallback((sessionId: string) => {
    const currentIndex = sessions.findIndex((session) => session.id === sessionId)
    const isClosingActive = activeSessionId === sessionId

    if (isClosingActive && currentIndex !== -1) {
      const nextIndex = currentIndex < sessions.length - 1 ? currentIndex + 1 : currentIndex - 1
      setActiveSessionId(sessions[nextIndex]?.id ?? null)
    }

    setSessions((prev) => prev.filter((session) => session.id !== sessionId))
  }, [
    activeSessionId,
    sessions,
    setActiveSessionId,
    setSessions,
  ])

  const handleCloseSessions = useCallback((sessionIds: string[]) => {
    const sessionIdSet = new Set(sessionIds)
    const remainingSessions = sessions.filter((session) => !sessionIdSet.has(session.id))

    if (activeSessionId && sessionIdSet.has(activeSessionId)) {
      setActiveSessionId(remainingSessions[0]?.id ?? null)
    }

    setSessions(remainingSessions)
  }, [
    activeSessionId,
    sessions,
    setActiveSessionId,
    setSessions,
  ])

  const handleDuplicateSession = (sessionId: string) => {
    const sftpTab = sftpTabs.find(tab => tab.id === sessionId)
    if (sftpTab) { handleCreateSftpTabFromServer(sftpTab.server, sftpTab.initialPath); return }
    const src = sessions.find((session) => session.id === sessionId)
    if (!src) return
    if (totalTabCount >= maxTabs) {
      toast.error(t("errorMaxTabsReached", { max: maxTabs }))
      return
    }

    const now = Date.now()
    const dup: TerminalSession = {
      ...src,
      id: `session-${now}`,
      lastActivity: now,
      pinned: false,
      connectionPhase: src.type === "terminal" ? "idle" : src.connectionPhase,
      status: src.type === "terminal" ? "reconnecting" : src.status,
    }

    setSessions((prev) => [...prev, dup])
    setActiveSessionId(dup.id)
    updateSessionActivity(dup.id, now)
  }

  const handleCloseOthers = (sessionId: string) => {
    setSftpTabs(current => current.filter(tab => tab.id === sessionId || tab.pinned))
    setActiveSftpTabId(sftpTabs.some(tab => tab.id === sessionId) ? sessionId : null)
    setSessions((prev) => prev.filter((session) => session.id === sessionId || session.pinned))
    setActiveSessionId(sessions.some(session => session.id === sessionId) ? sessionId : null)
  }

  const handleCloseAll = () => {
    setSftpTabs(current => current.filter(tab => tab.pinned))
    setActiveSftpTabId(null)
    const next = sessions.filter((session) => session.pinned)
    setSessions(next)
    setActiveSessionId(next[0]?.id ?? null)
  }

  const handleTogglePin = (sessionId: string) => {
    setSftpTabs(current => current.map(tab => tab.id === sessionId ? { ...tab, pinned: !tab.pinned } : tab))
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? { ...session, pinned: !session.pinned }
        : session
    )))
  }

  const handleConnectionPhaseChange = useCallback((sessionId: string, phase: TerminalConnectionPhase) => {
    setSessions((prev) => prev.map((session) => {
      if (session.id !== sessionId) return session

      return {
        ...session,
        connectionPhase: phase,
        status: statusFromConnectionPhase(phase),
      }
    }))

    if (phase === "ready") {
      updateSessionActivity(sessionId)
    }
  }, [setSessions, updateSessionActivity])

  const handleAuthCancelled = useCallback((sessionId: string) => {
    useTerminalStore.getState().destroySession(sessionId)
    handleCloseSession(sessionId)
  }, [handleCloseSession])

  const handleReorder = (newOrderIds: string[]) => {
    const map = new Map(sessions.map((session) => [session.id, session]))
    const newList = newOrderIds.map((id) => map.get(id)!).filter(Boolean)
    if (newList.length === sessions.length) setSessions(newList)
  }

  const handleSendCommand = (sessionId: string, command: string) => {
    if (isViteDev() && command.trim()) {
      // console.log(`Session ${sessionId}: ${command}`)
    }

    updateSessionActivity(sessionId)
    inactivityNotifiedRef.current.delete(sessionId)
  }

  const renderSftpTabContent = useCallback((session: TerminalSession, options?: TerminalExtraSessionRenderOptions) => {
    const tab = sftpTabs.find((item) => item.id === session.id)
    if (!tab) return null

    return (
      <TerminalSftpTabContent
        sessionId={tab.id}
        isActive={options?.isActive ?? true}
        externalTransferTasks={options?.externalTransferTasks}
        onClearExternalTransfers={options?.onClearExternalTransfers}
        onCancelExternalTransfer={options?.onCancelExternalTransfer}
        server={tab.server}
        label={tab.label}
        chrome={options?.chrome}
        surface={options?.surface}
        onConnectionStateChange={(connected, loading) => {
          const phase: TerminalConnectionPhase = connected ? "ready" : loading ? "ssh_connecting" : "failed"
          setSftpTabs(current => current.some(item => item.id === tab.id && item.connectionPhase !== phase) ? current.map(item => item.id === tab.id ? { ...item, connectionPhase: phase } : item) : current)
        }}
        onPathChange={(path) => {
          options?.onPathChange?.(path)
          setSftpTabs(current => current.some(item => item.id === tab.id && item.initialPath !== path) ? current.map(item => item.id === tab.id ? { ...item, initialPath: path } : item) : current)
        }}
        refreshRequestVersion={options?.refreshRequestVersion}
        initialPath={options?.initialPath ?? tab.initialPath}
        initialPathBackStack={options?.initialPathBackStack}
        initialPathForwardStack={options?.initialPathForwardStack}
        onHistoryChange={options?.onHistoryChange}
        onClose={() => handleCloseSftpTab(tab.id)}
        onRenameSession={(label) => handleRenameSftpTab(tab.id, label)}
      />
    )
  }, [handleCloseSftpTab, handleRenameSftpTab, sftpTabs])

  const sessionsRef = useRef(sessions)
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      const threshold = inactiveMinutes * 60 * 1000

      sessionsRef.current.forEach((session) => {
        if (!shouldCheckTerminalInactivity(session)) {
          inactivityNotifiedRef.current.delete(session.id)
          return
        }

        const lastActivity = getSessionLastActivity(session.id) ?? session.lastActivity
        if (now - lastActivity >= threshold && !inactivityNotifiedRef.current.has(session.id)) {
          inactivityNotifiedRef.current.add(session.id)
          toast(t("inactiveToastTitle", { name: session.serverName }), {
            description: t("inactiveToastDescription", { minutes: inactiveMinutes }),
            action: { label: t("inactiveToastActionLabel"), onClick: () => handleCloseSession(session.id) },
          })
        }
      })
    }, 60 * 1000)

    return () => clearInterval(timer)
  }, [getSessionLastActivity, handleCloseSession, inactiveMinutes, t])

  return (
    <SshWorkspace
      adapters={workspaceAdapters}
      capabilities={workspaceCapabilities}
      layout="web"
    >
      <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
        {credentialDialog}
        <SftpServerPickerDialog
          open={canUseSftpCapability && sftpPickerOpen}
          ready={ready}
          serverApi={serversApi}
          onOpenChange={setSftpPickerOpen}
          onSelect={handleCreateSftpTabFromServer}
          currentServerId={sessions.find(session => session.id === activeSessionId)?.serverId}
          openedServerIds={sftpTabs.map(tab => String(tab.server.id))}
        />
        <TerminalComponent
          sessions={sessions}
          extraSessions={sftpTabSessions}
          extraNewSessionActions={canUseSftpCapability ? [{
            id: "new-sftp-session",
            label: "SFTP+",
            ariaLabel: t("sftpPickerActionLabel"),
            title: t("sftpPickerActionLabel"),
            onCreate: handleOpenSftpPicker,
          }] : []}
          renderExtraSessionContent={renderSftpTabContent}
          onOpenSftpSession={async (session, path) => {
              if (!session.serverId) return
              try { handleCreateSftpTabFromServer(await serversApi.getById(session.serverId), path ?? "~") }
              catch { toast.error(t("sftpPickerFailed")) }
            }}
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
          onStartConnection={handleStartConnection}
          onAuthCancelled={handleAuthCancelled}
          externalActiveSessionId={activeSessionId}
          onActiveSessionChange={setActiveSessionId}
          onConnectionPhaseChange={handleConnectionPhaseChange}
          onBehaviorSettingsChange={applyTerminalBehaviorSettings}
        />
      </div>
    </SshWorkspace>
  )
}

export default function TerminalPage() {
  return (
    <ViewportWorkspaceTransition>
      <TerminalPageContent />
    </ViewportWorkspaceTransition>
  )
}
