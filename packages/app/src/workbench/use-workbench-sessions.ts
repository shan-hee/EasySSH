import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "@/components/ui/sonner"
import { getServerAuthMethod } from "@/components/sftp/use-sftp-auth-retry"
import type { TerminalConnectionPhase, TerminalSession } from "@/components/terminal/types"
import { resolveTerminalInactiveMinutes } from "@/components/terminal/terminal-settings"
import { useSystemConfig } from "@/contexts/system-config-context"
import type { Server } from "@/lib/server-types"
import { loadTerminalSftpTabContent } from "@/lib/terminal-preload"
import { useTerminalSettingsStore } from "@/stores/terminal-settings-store"
import { useTerminalStore } from "@/stores/terminal-store"

const DEFAULT_MAX_TABS = 50

export function statusFromConnectionPhase(phase: TerminalConnectionPhase) {
  if (phase === "ready") return "connected" as const
  if (phase === "failed" || phase === "closed" || phase === "idle") return "disconnected" as const
  return "reconnecting" as const
}

export function getServerDisplayName(server: Server) {
  return server.name || `${server.username}@${server.host}:${server.port}`
}

function createTerminalSessionFromServer(sessionId: string, server: Server, now = Date.now()): TerminalSession {
  return {
    id: sessionId,
    serverId: String(server.id),
    authMethod: getServerAuthMethod(server),
    serverName: getServerDisplayName(server),
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

/** 文件标签：与终端会话并列显示，独立持有连接状态与当前路径。 */
export type WorkbenchSftpTab = {
  id: string
  label: string
  server: Server
  pinned: boolean
  initialPath: string
  connectionPhase: TerminalConnectionPhase
  createdAt: number
}

function createSftpTabId() {
  return `sftp-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createSftpTabSession(tab: WorkbenchSftpTab): TerminalSession {
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

function shouldCheckTerminalInactivity(session: TerminalSession) {
  return (
    session.type === "terminal" &&
    !!session.serverId &&
    session.connectionPhase === "ready" &&
    session.status === "connected"
  )
}

export interface UseWorkbenchSessionsOptions {
  /** 当前运行环境与授权是否允许打开文件标签。 */
  canUseSftp?: boolean
  /** 系统设置中的空闲提醒上限（分钟）；宿主没有该限制时不传。 */
  inactiveReminderLimit?: number
  /** 终端会话创建后通知宿主，例如记录最近连接。 */
  onConnectionStarted?: (server: Server) => void
}

/**
 * 工作台的会话编排：终端会话与文件标签的创建、关闭、复制、固定、排序，以及空闲提醒。
 * 终端会话保存在终端 store 中，切换视图不会重建连接；文件标签由工作台持有。
 */
export function useWorkbenchSessions({
  canUseSftp = true,
  inactiveReminderLimit,
  onConnectionStarted,
}: UseWorkbenchSessionsOptions = {}) {
  const { t } = useTranslation("terminal")
  const { config: systemConfig } = useSystemConfig()
  const maxTabs = systemConfig?.tab_session?.max_tabs ?? DEFAULT_MAX_TABS
  const savedInactiveMinutes = useTerminalSettingsStore((state) => state.settings.inactiveMinutes)
  const inactiveMinutes = inactiveReminderLimit === undefined
    ? savedInactiveMinutes
    : resolveTerminalInactiveMinutes(savedInactiveMinutes, inactiveReminderLimit)

  const sessions = useTerminalStore((state) => state.sessions)
  const activeSessionId = useTerminalStore((state) => state.activeSessionId)
  const setSessions = useTerminalStore((state) => state.setSessions)
  const setActiveSessionId = useTerminalStore((state) => state.setActiveSessionId)
  const updateSessionActivity = useTerminalStore((state) => state.updateSessionActivity)
  const getSessionLastActivity = useTerminalStore((state) => state.getSessionLastActivity)
  const [sftpTabs, setSftpTabs] = useState<WorkbenchSftpTab[]>([])
  const [activeSftpTabId, setActiveSftpTabId] = useState<string | null>(null)
  const [sftpPickerOpen, setSftpPickerOpen] = useState(false)
  const inactivityNotifiedRef = useRef<Set<string>>(new Set())

  const sftpTabSessions = useMemo(() => sftpTabs.map(createSftpTabSession), [sftpTabs])
  const totalTabCount = sessions.length + sftpTabs.length
  const combinedSessionsRef = useRef<TerminalSession[]>([])
  combinedSessionsRef.current = [...sessions, ...sftpTabSessions]
  /** 终端会话与文件标签的当前快照，供跨服务器传输等适配器读取名称和认证方式。 */
  const getCombinedSessions = useCallback(() => combinedSessionsRef.current, [])

  const rejectWhenFull = useCallback((count: number) => {
    if (count < maxTabs) return false
    toast.error(t("errorMaxTabsReached", { max: maxTabs }))
    return true
  }, [maxTabs, t])

  const openSftpPicker = useCallback(() => {
    if (!canUseSftp || rejectWhenFull(totalTabCount)) return
    setSftpPickerOpen(true)
    void loadTerminalSftpTabContent().catch((error) => {
      console.error("Failed to preload SFTP tab:", error)
    })
  }, [canUseSftp, rejectWhenFull, totalTabCount])

  const createSftpTab = useCallback((server: Server, initialPath = "~"): boolean => {
    if (!canUseSftp || rejectWhenFull(totalTabCount)) return false

    const id = createSftpTabId()
    setSftpTabs((current) => [
      ...current,
      {
        id,
        label: getServerDisplayName(server),
        server,
        createdAt: Date.now(),
        pinned: false,
        initialPath,
        connectionPhase: "ssh_connecting",
      },
    ])
    setActiveSftpTabId(id)
    return true
  }, [canUseSftp, rejectWhenFull, totalTabCount])

  const closeSftpTab = useCallback((tabId: string) => {
    setSftpTabs((current) => current.filter((tab) => tab.id !== tabId))
    setActiveSftpTabId((current) => current === tabId ? null : current)
  }, [])

  const reorderSftpTabs = useCallback((newOrderIds: string[]) => {
    setSftpTabs((current) => {
      const tabMap = new Map(current.map((tab) => [tab.id, tab]))
      const ordered = newOrderIds
        .map((id) => tabMap.get(id))
        .filter((tab): tab is WorkbenchSftpTab => Boolean(tab))
      const orderedIds = new Set(ordered.map((tab) => tab.id))
      return [...ordered, ...current.filter((tab) => !orderedIds.has(tab.id))]
    })
  }, [])

  const renameSftpTab = useCallback((tabId: string, label: string) => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return
    setSftpTabs((current) => current.map((tab) => (
      tab.id === tabId ? { ...tab, label: trimmedLabel } : tab
    )))
  }, [])

  const updateSftpTab = useCallback((tabId: string, patch: Partial<Pick<WorkbenchSftpTab, "connectionPhase" | "initialPath">>) => {
    setSftpTabs((current) => {
      const changed = current.some((tab) => (
        tab.id === tabId &&
        Object.entries(patch).some(([key, value]) => tab[key as keyof typeof patch] !== value)
      ))
      return changed ? current.map((tab) => tab.id === tabId ? { ...tab, ...patch } : tab) : current
    })
  }, [])

  const startConnection = useCallback((server: Server): string | void => {
    if (rejectWhenFull(useTerminalStore.getState().sessions.length + sftpTabs.length)) return

    const now = Date.now()
    const sessionId = `session-${now}-${Math.random().toString(36).slice(2, 10)}`
    setSessions((current) => [...current, createTerminalSessionFromServer(sessionId, server, now)])
    setActiveSftpTabId(null)
    setActiveSessionId(sessionId)
    updateSessionActivity(sessionId, now)
    onConnectionStarted?.(server)
    return sessionId
  }, [onConnectionStarted, rejectWhenFull, setActiveSessionId, setSessions, sftpTabs.length, updateSessionActivity])

  const createVncTab = useCallback((server: Server): boolean => {
    if (rejectWhenFull(totalTabCount)) return false
    const now = Date.now()
    const session = { ...createTerminalSessionFromServer(`vnc-${crypto.randomUUID()}`, server, now), type: "vnc" as const }
    setSessions(current => [...current, session])
    setActiveSftpTabId(null)
    setActiveSessionId(session.id)
    return true
  }, [rejectWhenFull, totalTabCount, setSessions, setActiveSessionId])

  const createRdpTab = useCallback((server: Server): boolean => {
    if (rejectWhenFull(totalTabCount)) return false
    const now = Date.now()
    const session = { ...createTerminalSessionFromServer(`rdp-${crypto.randomUUID()}`, server, now), type: "rdp" as const }
    setSessions(current => [...current, session])
    setActiveSftpTabId(null)
    setActiveSessionId(session.id)
    return true
  }, [rejectWhenFull, totalTabCount, setSessions, setActiveSessionId])

  const closeSession = useCallback((sessionId: string) => {
    const currentIndex = sessions.findIndex((session) => session.id === sessionId)
    if (activeSessionId === sessionId && currentIndex !== -1) {
      const nextIndex = currentIndex < sessions.length - 1 ? currentIndex + 1 : currentIndex - 1
      setActiveSessionId(sessions[nextIndex]?.id ?? null)
    }
    setSessions((current) => current.filter((session) => session.id !== sessionId))
  }, [activeSessionId, sessions, setActiveSessionId, setSessions])

  const closeSessions = useCallback((sessionIds: string[]) => {
    const closing = new Set(sessionIds)
    const remaining = sessions.filter((session) => !closing.has(session.id))
    if (activeSessionId && closing.has(activeSessionId)) {
      setActiveSessionId(remaining[0]?.id ?? null)
    }
    setSessions(remaining)
  }, [activeSessionId, sessions, setActiveSessionId, setSessions])

  const duplicateSession = useCallback((sessionId: string) => {
    const sftpTab = sftpTabs.find((tab) => tab.id === sessionId)
    if (sftpTab) {
      createSftpTab(sftpTab.server, sftpTab.initialPath)
      return
    }
    const source = sessions.find((session) => session.id === sessionId)
    if (!source || rejectWhenFull(totalTabCount)) return

    const now = Date.now()
    const duplicate: TerminalSession = {
      ...source,
      id: `session-${crypto.randomUUID()}`,
      lastActivity: now,
      pinned: false,
      connectionPhase: source.type === "terminal" || (source.type === "vnc" || source.type === "rdp") ? "idle" : source.connectionPhase,
      status: source.type === "terminal" || (source.type === "vnc" || source.type === "rdp") ? "reconnecting" : source.status,
    }
    setSessions((current) => [...current, duplicate])
    setActiveSessionId(duplicate.id)
    updateSessionActivity(duplicate.id, now)
  }, [createSftpTab, rejectWhenFull, sessions, setActiveSessionId, setSessions, sftpTabs, totalTabCount, updateSessionActivity])

  const closeOthers = useCallback((sessionId: string) => {
    setSftpTabs((current) => current.filter((tab) => tab.id === sessionId || tab.pinned))
    setActiveSftpTabId(sftpTabs.some((tab) => tab.id === sessionId) ? sessionId : null)
    setSessions((current) => current.filter((session) => session.id === sessionId || session.pinned))
    setActiveSessionId(sessions.some((session) => session.id === sessionId) ? sessionId : null)
  }, [sessions, setActiveSessionId, setSessions, sftpTabs])

  const closeAll = useCallback(() => {
    setSftpTabs((current) => current.filter((tab) => tab.pinned))
    setActiveSftpTabId(null)
    const pinned = sessions.filter((session) => session.pinned)
    setSessions(pinned)
    setActiveSessionId(pinned[0]?.id ?? null)
  }, [sessions, setActiveSessionId, setSessions])

  const togglePin = useCallback((sessionId: string) => {
    setSftpTabs((current) => current.map((tab) => tab.id === sessionId ? { ...tab, pinned: !tab.pinned } : tab))
    setSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, pinned: !session.pinned } : session
    )))
  }, [setSessions])

  const reorderSessions = useCallback((newOrderIds: string[]) => {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]))
    const next = newOrderIds
      .map((id) => sessionMap.get(id))
      .filter((session): session is TerminalSession => Boolean(session))
    if (next.length === sessions.length) setSessions(next)
  }, [sessions, setSessions])

  const recordCommand = useCallback((sessionId: string) => {
    updateSessionActivity(sessionId)
    inactivityNotifiedRef.current.delete(sessionId)
  }, [updateSessionActivity])

  const changeConnectionPhase = useCallback((sessionId: string, phase: TerminalConnectionPhase) => {
    setSessions((current) => current.map((session) => (
      session.id === sessionId
        ? { ...session, connectionPhase: phase, status: statusFromConnectionPhase(phase) }
        : session
    )))
    if (phase === "ready") updateSessionActivity(sessionId)
  }, [setSessions, updateSessionActivity])

  const cancelAuthentication = useCallback((sessionId: string) => {
    useTerminalStore.getState().destroySession(sessionId)
    closeSession(sessionId)
  }, [closeSession])

  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  useEffect(() => {
    inactivityNotifiedRef.current.clear()
    if (inactiveMinutes === 0) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      const threshold = inactiveMinutes * 60 * 1000

      sessionsRef.current.forEach((session) => {
        if (!shouldCheckTerminalInactivity(session)) {
          inactivityNotifiedRef.current.delete(session.id)
          return
        }

        const lastActivity = getSessionLastActivity(session.id) ?? session.lastActivity
        if (now - lastActivity < threshold || inactivityNotifiedRef.current.has(session.id)) return
        inactivityNotifiedRef.current.add(session.id)
        toast(t("inactiveToastTitle", { name: session.serverName }), {
          description: t("inactiveToastDescription", { minutes: inactiveMinutes }),
          action: { label: t("inactiveToastActionLabel"), onClick: () => closeSession(session.id) },
        })
      })
    }, 60 * 1000)

    return () => window.clearInterval(timer)
  }, [closeSession, getSessionLastActivity, inactiveMinutes, t])

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    sftpTabs,
    sftpTabSessions,
    activeSftpTabId,
    setActiveSftpTabId,
    sftpPickerOpen,
    setSftpPickerOpen,
    canUseSftp,
    inactiveReminderLimit,
    getCombinedSessions,
    openSftpPicker,
    createSftpTab,
    createVncTab,
    createRdpTab,
    closeSftpTab,
    reorderSftpTabs,
    renameSftpTab,
    updateSftpTab,
    startConnection,
    closeSession,
    closeSessions,
    duplicateSession,
    closeOthers,
    closeAll,
    togglePin,
    reorderSessions,
    recordCommand,
    changeConnectionPhase,
    cancelAuthentication,
  }
}

export type WorkbenchSessions = ReturnType<typeof useWorkbenchSessions>
