import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { RDPSession } from "@/components/rdp/rdp-session"
import { VNCSession } from "@/components/vnc/vnc-session"
import { ActivityOverview } from "@/components/activity/activity-overview"
import { ApprovedScripts } from "./approved-scripts"
import { WorkspaceRelay } from "./workspace-relay"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { PageHeader, WorkspaceHeaderHost } from "@/components/page-header"
import { ThemeMenu } from "@/components/theme-menu"
import { SERVER_GRID_CLASSNAME, getServerItemClassName, ServerConnectionSummary } from "@/components/servers/server-connection-item"
import { WORKBENCH_VIEW, WorkspaceShell } from "@/workbench/workspace-shell"
import { cn } from "@/lib/utils"
import { SidebarProvider } from "@/components/ui/sidebar"
import { SshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { TabTerminalContent } from "@/components/terminal/tab-terminal-content"
import { TerminalSftpTabContent } from "@/components/terminal/terminal-sftp-tab-content"
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
import type { TerminalSession } from "@/components/terminal/types"
import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

type Mode = "terminal" | "files" | "monitor" | "docker" | "vnc" | "rdp"
const modeAction = {
  terminal: "terminal.connect",
  files: "files.list",
  monitor: "monitor.read",
  docker: "docker.read",
  vnc: "vnc.connect",
  rdp: "rdp.connect",
} as const
type OpenTab = { id: string; resourceId: string; server: Server; mode: Mode }

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
  const { t: tServers } = useTranslation("servers")
  const { confirm, confirmDialog } = useConfirmDialog()
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [search, setSearch] = useState("")
  const initialOpened = useRef(false)
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
  const visibleResources = context.resources.filter((resource) =>
    [resource.name, resource.host, resource.username].some((value) =>
      value?.toLowerCase().includes(search.trim().toLowerCase()),
    ),
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
  const openResource = async (r: AccessResource, mode: Mode) => {
    if (pendingOpen.current) return
    pendingOpen.current = true
    setOpening(true)
    await attempt(async () => {
      const existing = tabs.find(
        (tab) => tab.resourceId === r.id && tab.mode === mode,
      )
      if (existing) {
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
      const tab = {
        id: `access-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        resourceId: r.id,
        server,
        mode,
      }
      setTabs((current) => [...current, tab])
      setActive(tab.id)
    })
    pendingOpen.current = false
    if (mounted.current) setOpening(false)
  }
  useEffect(() => {
    if (initialOpened.current) return
    initialOpened.current = true
    const resources = context.resources.filter((r) => !r.paused)
    if (resources.length === 1) {
      const resource = resources[0]
      const mode = context.default_content as Mode
      if (modeAction[mode] && resource.actions.includes(modeAction[mode]))
        void openResource(resource, mode)
    }
  }, [context])
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
  return (
    <SidebarProvider
      defaultOpen={false}
      className="h-svh min-h-0 flex-col overflow-hidden"
    >
      <WorkspaceHeaderHost showSidebarTrigger={false} actions={<ThemeMenu />}>
        <PageHeader title={context.grant_name} titleActions={
          <span className="hidden text-xs text-muted-foreground lg:inline">
            {t("sharedWorkspace")} ·{" "}
            {t("expires", {
              date: new Date(context.expires_at).toLocaleString(),
            })}
          </span>
        }>
            <Button
              size="sm"
              variant={activeView === WORKBENCH_VIEW ? "secondary" : "ghost"}
              onClick={() => {
                setActive("")
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
        </PageHeader>
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
        {tabs.length > 0 && (
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-1">
            {tabs.map((tab) => (
              <div className="flex items-center" key={tab.id}>
                <Button
                  variant={active === tab.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setActive(tab.id)}
                >
                  {tab.server.name || tab.server.host} · {t(tab.mode)}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("close")}
                  onClick={() => closeTab(tab.id)}
                >
                  ×
                </Button>
              </div>
            ))}
          </nav>
        )}
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4 sm:pb-4">
          <WorkspaceShell
            className="rounded-xl border"
            activeView={activeView}
            workbench={
              <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                <div className="w-full max-w-6xl space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-sm font-semibold">{t("resources")}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{t("chooseResource")}</p>
                    </div>
                    <div className="relative w-full sm:max-w-xs">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        aria-label={tServers("searchPlaceholder")}
                        placeholder={tServers("searchPlaceholder")}
                        className="bg-card pl-10"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className={SERVER_GRID_CLASSNAME}>
                    {visibleResources.map((resource) => (
                      <section key={resource.id} className={cn(getServerItemClassName("grid", false), "content-start")}>
                        <ServerConnectionSummary server={resource} />
                        <div className="col-span-full space-y-3">
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {resource.actions.map((action) => t(`actions.${action}`)).join(" · ")}
                          </p>
                          {resource.paused ? (
                            <p className="text-sm text-muted-foreground">{t("paused")}</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {(Object.keys(modeAction) as Mode[])
                                .sort((a, b) => Number(b === context.default_content) - Number(a === context.default_content))
                                .filter((mode) => resource.actions.includes(modeAction[mode]))
                                .map((mode) => (
                                  <Button
                                    key={mode}
                                    size="sm"
                                    disabled={opening}
                                    variant={mode === context.default_content ? "default" : "outline"}
                                    onClick={() => void openResource(resource, mode)}
                                  >
                                    {t(mode)}
                                  </Button>
                                ))}
                              {resource.actions.includes("scripts.execute") && <ApprovedScripts serverId={resource.id} />}
                            </div>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                  {visibleResources.length === 0 && (
                    <p className="py-12 text-center text-sm text-muted-foreground">{t("noResources")}</p>
                  )}
                </div>
              </div>
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
                    canCleanup={false}
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
        </WorkspaceHeaderHost>
      {confirmDialog}
    </SidebarProvider>
  )
}

function AccessResourcePanel({
  tab,
  resource,
  active,
  adapters,
  close,
  fileActions,
  desktop,
}: {
  tab: OpenTab
  resource: AccessResource
  active: boolean
  adapters: SshWorkspaceAdapters
  close: () => void
  fileActions?: (resource: AccessResource, path: string) => ReactNode
  desktop: boolean
}) {
  const [path, setPath] = useState("~")
  const settings = useTerminalSettingsStore((s) => s.settings)
  const [session, setSession] = useState<TerminalSession>(() => ({
    id: tab.id,
    serverId: tab.server.id,
    serverName: tab.server.name || tab.server.host,
    host: tab.server.host,
    port: tab.server.port,
    username: tab.server.username,
    authMethod: tab.server.auth_method,
    shouldConnect: true,
    connectionPhase: "idle",
    status: "reconnecting",
    lastActivity: Date.now(),
    type: "terminal",
  }))
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
      {tab.mode === "rdp" && <RDPSession serverId={tab.server.id} isActive={active} onPhase={() => undefined} createSocket={adapters.apiClient?.remoteDesktopSocket} />}
      {tab.mode === "vnc" && <VNCSession serverId={tab.server.id} isActive={active} onPhase={() => undefined} createSocket={adapters.apiClient?.remoteDesktopSocket} />}
      {tab.mode === "terminal" && (
        <TabTerminalContent
          session={session}
          isActive={active}
          settings={settings}
          effectiveIsLoading={false}
          onCommand={() => undefined}
          onAuthCancelled={close}
          onConnectionPhaseChange={(_, phase) =>
            setSession((s) => ({
              ...s,
              connectionPhase: phase,
              status:
                phase === "ready"
                  ? "connected"
                  : phase === "failed" || phase === "closed"
                    ? "disconnected"
                    : "reconnecting",
            }))
          }
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
