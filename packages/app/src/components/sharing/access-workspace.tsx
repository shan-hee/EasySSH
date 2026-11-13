import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { RDPSession } from "@/components/rdp/rdp-session"
import { VNCSession } from "@/components/vnc/vnc-session"
import { ActivityOverview } from "@/components/activity/activity-overview"
import { ApprovedScripts } from "./approved-scripts"
import { WorkspaceRelay } from "./workspace-relay"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Share2 } from "lucide-react"
import { SessionTabBar } from "@/components/tabs/session-tab-bar"
import { AccessServerList, accessModeActions as modeAction, type AccessResourceMode as Mode } from "./access-server-list"
import { ThemeMenu } from "@/components/theme-menu"
import { WORKBENCH_VIEW, WorkspaceShell } from "@/workbench/workspace-shell"
import { SidebarProvider } from "@/components/ui/sidebar"
import { SshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { TabTerminalContent } from "@/components/terminal/tab-terminal-content"
import { TerminalSftpTabContent } from "@/components/terminal/terminal-sftp-tab-content"
import { TerminalSettingsDialog } from "@/components/terminal/terminal-settings-dialog"
import { MonitorPanel } from "@/components/terminal/monitor/MonitorPanel"
import { MonitorWebSocketProvider } from "@/components/terminal/monitor/contexts/MonitorWebSocketContext"
import { DockerPopover } from "@/components/terminal/docker"
import { AIWorkspace } from "@/workbench/ai-workspace"
import { TaskCenterView } from "@/components/task-center/task-center-view"
import { taskCenterApi, type TaskCenterApi } from "@/lib/api/task-center"
import { useTerminalSettingsStore } from "@/stores/terminal-settings-store"
import { useTerminalStore } from "@/stores/terminal-store"
import { serversApi } from "@/lib/api/servers"
import type { Server } from "@/lib/server-types"
import type { AccessContext, AccessResource } from "@/lib/api/grants"
import type { SshWorkspaceAdapters } from "@/lib/session/workspace"
import type { AIAssistantWorkspaceAdapters } from "@/components/ai-agent/ai-assistant-workspace-view"
import type { TerminalConnectionPhase, TerminalSession } from "@/components/terminal/types"
import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

type OpenTab = { id: string; resourceId: string; server: Server; mode: Mode; session: TerminalSession }

/** Shared visitors use the existing task components, with only explicitly granted resources. */
export function AccessWorkspace({
  context,
  adapters,
  refresh,
  aiAdapters,
  tasks = taskCenterApi,
  loadServer = serversApi.getById,
  desktop = false,
  header,
  fileActions,
  onLeave,
}: {
  context: AccessContext
  adapters: SshWorkspaceAdapters
  refresh: () => Promise<void>
  aiAdapters?: AIAssistantWorkspaceAdapters
  tasks?: TaskCenterApi
  loadServer?: (id: string) => Promise<Server>
  desktop?: boolean
  header?: ReactNode
  fileActions?: (resource: AccessResource, path: string) => ReactNode
  onLeave?: () => Promise<void>
}) {
  const { t } = useTranslation("sharing")
  const { confirm, confirmDialog } = useConfirmDialog()
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [resourceMode, setResourceMode] = useState<Mode | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settings = useTerminalSettingsStore(state => state.settings)
  const saveSettings = useTerminalSettingsStore(state => state.saveSettings)
  const mounted = useRef(false)
  const pendingOpen = useRef(false)
  const latestContext = useRef(context)
  latestContext.current = context
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [active, setActive] = useState("")
  const [error, setError] = useState("")
  const [opening, setOpening] = useState(false)
  const [handoff, setHandoff] = useState<
    components["schemas"]["AccessHandoff"] | null
  >(null)
  const [requestedTask, setRequestedTask] = useState<string | null>(null)
  const visitorTasks = useMemo<TaskCenterApi>(
    () => ({
      ...tasks,
      async list(params) {
        const result = await tasks.list(params)
        return {
          ...result,
          runs: result.runs.map((run) => ({ ...run, retryable: false })),
        }
      },
      async get(id) {
        const result = await tasks.get(id)
        return { ...result, run: { ...result.run, retryable: false } }
      },
    }),
    [tasks],
  )
  const canAI = context.resources.some(
    (r) => !r.paused && r.actions.includes("ai.use"),
  )
  const canActivity = context.resources.some(
    (r) => !r.paused && r.actions.includes("activity.read"),
  )
  const activeView =
    tabs.some((tab) => tab.id === active && context.resources.some((resource) =>
      resource.id === tab.resourceId && !resource.paused && resource.actions.includes(modeAction[tab.mode]),
    )) || active === "tasks" || (active === "ai" && canAI) || (active === "activity" && canActivity)
      ? active
      : WORKBENCH_VIEW
  const attempt = async (fn: () => Promise<void>) => {
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const openResource = async (r: AccessResource, mode: Mode, duplicate = false) => {
    if (pendingOpen.current || !latestContext.current.resources.some(resource => resource.id === r.id && !resource.paused && resource.actions.includes(modeAction[mode]))) return
    pendingOpen.current = true
    setOpening(true)
    await attempt(async () => {
      const existing = tabs.find(
        (tab) => tab.resourceId === r.id && tab.mode === mode,
      )
      if (existing && !duplicate) {
        setActive(existing.id)
        return
      }
      const server = await loadServer(r.id)
      if (
        !mounted.current ||
        !latestContext.current.resources.some(
          (resource) =>
            resource.id === r.id &&
            !resource.paused &&
            resource.actions.includes(modeAction[mode]),
        )
      )
        return
      const id = `access-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const tab: OpenTab = {
        id,
        resourceId: r.id,
        server,
        mode,
        session: {
          id, serverId: server.id, serverName: server.name || server.host,
          host: server.host, port: server.port, username: server.username,
          authMethod: server.auth_method, shouldConnect: true,
          connectionPhase: mode === "monitor" || mode === "docker" ? "ready" : "idle",
          status: mode === "monitor" || mode === "docker" ? "connected" : "reconnecting",
          lastActivity: Date.now(),
          type: mode === "files" ? "sftp" : mode === "monitor" || mode === "docker" ? "config" : mode,
        },
      }
      setTabs((current) => [...current, tab])
      setActive(tab.id)
    })
    pendingOpen.current = false
    if (mounted.current) setOpening(false)
  }
  const closeTab = (id: string) => {
    useTerminalStore.getState().destroySession(id)
    setTabs((current) => current.filter((tab) => tab.id !== id))
    setActive((current) => (current === id ? "" : current))
  }
  useEffect(() => {
    const valid = new Set(
      context.resources.filter((r) => !r.paused).map((r) => r.id),
    )
    setTabs((current) =>
      current.filter((tab) => {
        const resource = context.resources.find((r) => r.id === tab.resourceId)
        const keep =
          valid.has(tab.resourceId) &&
          resource?.actions.includes(modeAction[tab.mode])
        if (!keep) useTerminalStore.getState().destroySession(tab.id)
        return keep
      }),
    )
  }, [context])
  useEffect(() => {
    const focus = () => {
      void attempt(refresh)
    }
    window.addEventListener("focus", focus)
    const remaining = new Date(context.expires_at).getTime() - Date.now()
    const timer = window.setTimeout(
      focus,
      Math.max(0, Math.min(remaining + 100, 2147483647)),
    )
    return () => {
      window.removeEventListener("focus", focus)
      window.clearTimeout(timer)
    }
  }, [context.expires_at, refresh])
  useEffect(() => () => useTerminalStore.getState().destroyAll(), [])
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id
      if (id) {
        setRequestedTask(id)
        setActive("tasks")
      }
    }
    window.addEventListener("easyssh:open-task", open)
    return () => window.removeEventListener("easyssh:open-task", open)
  }, [])
  const updatePhase = useCallback((id: string, phase: TerminalConnectionPhase) => {
    setTabs(current => current.map(tab => tab.id !== id || tab.session.connectionPhase === phase ? tab : {
      ...tab,
      session: { ...tab.session, connectionPhase: phase, status: phase === "ready" ? "connected" : phase === "failed" || phase === "closed" ? "disconnected" : "reconnecting" },
    }))
  }, [])
  const showResources = (mode: Mode | null = null) => {
    setResourceMode(mode)
    setActive("")
  }
  const canOpenMode = (mode: Mode) => context.resources.some(resource => !resource.paused && resource.actions.includes(modeAction[mode]))
  const tabSessions = tabs.map(tab => ({
    ...tab.session,
    serverName: tab.mode === "monitor" || tab.mode === "docker" ? `${tab.session.serverName} · ${t(tab.mode)}` : tab.session.serverName,
  }))
  return (
    <SidebarProvider
      defaultOpen={false}
      className="h-svh min-h-0 flex-col overflow-hidden"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 bg-muted/40 px-4 py-2" data-share-banner>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"><Share2 className="size-3.5" />{t("sharedWorkspace")}</span>
          <h1 className="max-w-64 truncate text-sm font-semibold" title={context.grant_name}>{context.grant_name}</h1>
          <span className="text-xs text-muted-foreground">{t("expires", { date: new Date(context.expires_at).toLocaleString() })}</span>
        </div>
        <div className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto scrollbar-none">
            <Button
              size="sm"
              variant={activeView === WORKBENCH_VIEW ? "secondary" : "ghost"}
              onClick={() => {
                showResources()
                void attempt(refresh)
              }}
            >
              {t("resources")}
            </Button>
            {canAI && (
              <Button
                size="sm"
                variant={activeView === "ai" ? "secondary" : "ghost"}
                onClick={() => {
                  setActive("ai")
                }}
              >
                AI
              </Button>
            )}
            {
              <Button
                size="sm"
                variant={activeView === "tasks" ? "secondary" : "ghost"}
                onClick={() => setActive("tasks")}
              >
                {t("tasks")}
              </Button>
            }
            {canActivity && (
              <Button
                size="sm"
                variant={activeView === "activity" ? "secondary" : "ghost"}
                onClick={() => setActive("activity")}
              >
                {t("activity")}
              </Button>
            )}
            <WorkspaceRelay resources={context.resources} desktop={desktop} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void attempt(refresh)}
            >
              {t("refresh")}
            </Button>
            {!desktop && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void attempt(async () => {
                    const value = await apiFetch<
                      components["schemas"]["AccessHandoff"]
                    >("/access/handoffs", { method: "POST", body: {} })
                    setHandoff(value)
                    window.location.assign(
                      `easyssh://access?${new URLSearchParams({ origin: window.location.origin, handoff: value.id })}`,
                    )
                  })
                }
              >
                {t("openDesktop")}
              </Button>
            )}
            {header}
            {onLeave && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void attempt(onLeave)}
              >
                {t("leave")}
              </Button>
            )}
        </div>
      </header>
        {error && (
          <div
            role="alert"
            className="shrink-0 border-b p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        {handoff && (
          <div className="shrink-0 space-y-2 border-b p-3 text-sm">
            <p>{t("handoffHint")}</p>
            <p>
              {handoff.receiver_name} {handoff.confirmation}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  void attempt(async () =>
                    setHandoff(await apiFetch(`/access/handoffs/${handoff.id}`)),
                  )
                }
              >
                {t("refresh")}
              </Button>
              <Button
                size="sm"
                disabled={!handoff.confirmation || !!handoff.approved_at}
                onClick={() => {
                  void attempt(async () => {
                    if (!await confirm({ description: t("approveHandoff", { code: handoff.confirmation }) })) return
                    await apiFetch(`/access/handoffs/${handoff.id}/approve`, {
                      method: "POST",
                      body: { confirmation: handoff.confirmation },
                    })
                    setHandoff(await apiFetch(`/access/handoffs/${handoff.id}`))
                  })
                }}
              >
                {t("confirm")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHandoff(null)}>
                {t("close")}
              </Button>
            </div>
          </div>
        )}
        <SessionTabBar
          sessions={tabSessions}
          activeId={activeView}
          onChangeActive={setActive}
          onNewSession={() => showResources()}
          onNewSftpSession={canOpenMode("files") ? () => showResources("files") : undefined}
          onNewVncSession={canOpenMode("vnc") ? () => showResources("vnc") : undefined}
          onNewRdpSession={canOpenMode("rdp") ? () => showResources("rdp") : undefined}
          onCloseSession={closeTab}
          onDuplicateSession={id => {
            const tab = tabs.find(item => item.id === id)
            const resource = context.resources.find(item => item.id === tab?.resourceId)
            if (tab && resource) void openResource(resource, tab.mode, true)
          }}
          onCloseOthers={id => tabs.filter(tab => tab.id !== id && !tab.session.pinned).forEach(tab => closeTab(tab.id))}
          onCloseAll={() => tabs.filter(tab => !tab.session.pinned).forEach(tab => closeTab(tab.id))}
          onTogglePin={id => setTabs(current => current.map(tab => tab.id === id ? { ...tab, session: { ...tab.session, pinned: !tab.session.pinned } } : tab))}
          onReorder={ids => setTabs(current => ids.flatMap(id => current.filter(tab => tab.id === id)))}
          canAcceptCrossSessionFileDrop={() => false}
          onOpenSettings={() => setSettingsOpen(true)}
          hideBreadcrumb
          endContent={<div className="flex items-center pr-2"><ThemeMenu /></div>}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkspaceShell
            activeView={activeView}
            workbench={
              <AccessServerList
                resources={context.resources}
                defaultContent={context.default_content}
                mode={resourceMode}
                opening={opening}
                onClearMode={() => setResourceMode(null)}
                onOpen={(resource, mode) => void openResource(resource, mode)}
              />
            }
            views={[
              ...tabs.flatMap((tab) => {
                const resource = context.resources.find((item) => item.id === tab.resourceId)
                if (!resource || resource.paused || !resource.actions.includes(modeAction[tab.mode])) return []
                return [{
                  id: tab.id,
                  className: "flex-col",
                  content: (
                    <AccessResourcePanel
                      tab={tab}
                      resource={resource}
                      active={activeView === tab.id}
                      adapters={adapters}
                      desktop={desktop}
                      fileActions={fileActions}
                      close={() => closeTab(tab.id)}
                      onPhase={updatePhase}
                    />
                  ),
                }]
              }),
              ...(canAI ? [{
                id: "ai",
                className: "flex-col",
                content: <AIWorkspace active={activeView === "ai"} hidePageHeader canConfigure={false} adapters={aiAdapters} />,
              }] : []),
              {
                id: "tasks",
                keepAlive: false,
                className: "flex-col overflow-auto",
                content: (
                  <TaskCenterView
                    api={visitorTasks}
                    hidePageHeader
                    requestedRunID={requestedTask}
                    onClearRequestedRun={() => setRequestedTask(null)}
                  />
                ),
              },
              ...(canActivity ? [{
                id: "activity",
                keepAlive: false,
                className: "flex-col overflow-auto p-4",
                content: <ActivityOverview scope={context.actor.session_id} />,
              }] : []),
            ]}
          />
        </div>
      {confirmDialog}
      <TerminalSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onSettingsChange={saveSettings} />
    </SidebarProvider>
  )
}

function AccessResourcePanel({
  tab,
  resource,
  active,
  adapters,
  close,
  onPhase,
  fileActions,
  desktop,
}: {
  tab: OpenTab
  resource: AccessResource
  active: boolean
  adapters: SshWorkspaceAdapters
  close: () => void
  onPhase: (id: string, phase: TerminalConnectionPhase) => void
  fileActions?: (resource: AccessResource, path: string) => ReactNode
  desktop: boolean
}) {
  const [path, setPath] = useState("~")
  const settings = useTerminalSettingsStore((s) => s.settings)
  const session = tab.session
  const capabilities = useMemo(
    () => ({
      terminal: resource.actions.includes("terminal.connect"),
      sftp: resource.actions.includes("files.list"),
      monitor: resource.actions.includes("monitor.read"),
      docker: resource.actions.includes("docker.read"),
      ai: false,
      activityLog: false,
      transfers:
        resource.actions.includes("files.download") ||
        resource.actions.includes("files.upload"),
      fullscreen: true,
      crossSessionDrag: false,
      allowedActions: desktop
        ? resource.actions.filter((action) => action !== "files.upload")
        : resource.actions,
    }),
    [resource.actions, desktop],
  )
  return (
    <SshWorkspace
      adapters={adapters}
      capabilities={capabilities}
      layout="embedded"
    >
      {tab.mode === "rdp" && <RDPSession serverId={tab.server.id} isActive={active} onPhase={phase => onPhase(tab.id, phase)} createSocket={adapters.apiClient?.remoteDesktopSocket} />}
      {tab.mode === "vnc" && <VNCSession serverId={tab.server.id} isActive={active} onPhase={phase => onPhase(tab.id, phase)} createSocket={adapters.apiClient?.remoteDesktopSocket} />}
      {tab.mode === "terminal" && (
        <TabTerminalContent
          session={session}
          isActive={active}
          settings={settings}
          effectiveIsLoading={false}
          onCommand={() => undefined}
          onAuthCancelled={close}
          onConnectionPhaseChange={onPhase}
        />
      )}
      {tab.mode === "files" && (
        <>
          <div className="flex gap-2 border-b p-2">
            {path !== "~" && fileActions?.(resource, path)}
            {resource.actions.includes("scripts.execute") && (
              <ApprovedScripts serverId={resource.id} />
            )}
          </div>
          <TerminalSftpTabContent
            sessionId={tab.id}
            isActive={active}
            server={tab.server}
            label={tab.server.name || tab.server.host}
            initialPath="~"
            onPathChange={setPath}
            onConnectionStateChange={(connected, loading) => onPhase(tab.id, connected ? "ready" : loading ? "ssh_connecting" : "failed")}
            onClose={close}
            onRenameSession={() => undefined}
          />
        </>
      )}
      {tab.mode === "monitor" && (
        <MonitorWebSocketProvider
          serverId={tab.server.id}
          enabled={active}
          monitorApi={adapters.apiClient?.monitor}
        >
          <MonitorPanel />
        </MonitorWebSocketProvider>
      )}
      {tab.mode === "docker" && (
        <div className="overflow-auto p-4">
          <DockerPopover
            serverId={tab.server.id}
            sessionId={tab.id}
            isConnected
            embedded
          />
        </div>
      )}
    </SshWorkspace>
  )
}
