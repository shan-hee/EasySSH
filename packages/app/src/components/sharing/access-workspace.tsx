import { RDPSession } from "@/components/rdp/rdp-session"
import { VNCSession } from "@/components/vnc/vnc-session"
import { ActivityOverview } from "@/components/activity/activity-overview"
import { ApprovedScripts } from "./approved-scripts"
import { WorkspaceRelay } from "./workspace-relay"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
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
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [aiVisited, setAIVisited] = useState(false)
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
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b p-3">
        <strong>{context.grant_name}</strong>
        <span className="text-xs text-muted-foreground">
          {t("sharedWorkspace")} ·{" "}
          {t("expires", {
            date: new Date(context.expires_at).toLocaleString(),
          })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
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
              variant="outline"
              onClick={() => {
                setAIVisited(true)
                setActive("ai")
              }}
            >
              AI
            </Button>
          )}
          {
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActive("tasks")}
            >
              {t("tasks")}
            </Button>
          }
          {canActivity && (
            <Button
              size="sm"
              variant="outline"
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
                if (
                  window.confirm(
                    t("approveHandoff", { code: handoff.confirmation }),
                  )
                )
                  void attempt(async () => {
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
      <main className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        {(!active ||
          (!tabs.some((tab) => tab.id === active) &&
            active !== "ai" &&
            active !== "tasks" &&
            active !== "activity")) && (
          <div className="space-y-3 overflow-y-auto p-4">
            <p className="text-sm text-muted-foreground">
              {t("chooseResource")}
            </p>
            {context.resources.map((r) => (
              <section key={r.id} className="space-y-2 rounded-lg border p-4">
                <h2 className="font-medium">{r.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {r.username}@{r.host}:{r.port}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.actions.map((a) => t(`actions.${a}`)).join(" · ")}
                </p>
                {r.paused ? (
                  <p className="text-sm">{t("paused")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(modeAction) as Mode[])
                      .sort(
                        (a, b) =>
                          Number(b === context.default_content) -
                          Number(a === context.default_content),
                      )
                      .filter((mode) => r.actions.includes(modeAction[mode]))
                      .map((mode) => (
                        <Button
                          key={mode}
                          disabled={opening}
                          variant={
                            mode === context.default_content
                              ? "default"
                              : "outline"
                          }
                          onClick={() => void openResource(r, mode)}
                        >
                          {t(mode)}
                        </Button>
                      ))}
                    {r.actions.includes("scripts.execute") && (
                      <ApprovedScripts serverId={r.id} />
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
        {tabs.map((tab) => {
          const resource = context.resources.find(
            (r) => r.id === tab.resourceId,
          )
          return (
            resource &&
            !resource.paused && (
              <div
                key={tab.id}
                className={
                  active === tab.id
                    ? "absolute inset-0 flex min-h-0 flex-col"
                    : "hidden"
                }
                inert={active !== tab.id}
              >
                <AccessResourcePanel
                  tab={tab}
                  resource={resource}
                  active={active === tab.id}
                  adapters={adapters}
                  desktop={desktop}
                  fileActions={fileActions}
                  close={() => closeTab(tab.id)}
                />
              </div>
            )
          )
        })}
        {canAI && aiVisited && (
          <div
            className={
              active === "ai" ? "flex min-h-0 flex-1 flex-col" : "hidden"
            }
            inert={active !== "ai"}
          >
            <AIWorkspace
              active={active === "ai"}
              hidePageHeader
              canConfigure={false}
              adapters={aiAdapters}
            />
          </div>
        )}
        {active === "tasks" && (
          <div className="min-h-0 flex-1 overflow-auto">
            <TaskCenterView
              api={visitorTasks}
              hidePageHeader
              canCleanup={false}
              requestedRunID={requestedTask}
              onClearRequestedRun={() => setRequestedTask(null)}
            />
          </div>
        )}
        {canActivity && active === "activity" && (
          <div className="overflow-auto p-4">
            <ActivityOverview scope={context.actor.session_id} />
          </div>
        )}
      </main>
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
      {tab.mode === "rdp" && <RDPSession serverId={tab.server.id} isActive={active} onPhase={() => undefined} />}
      {tab.mode === "vnc" && <VNCSession serverId={tab.server.id} isActive={active} onPhase={() => undefined} />}
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
