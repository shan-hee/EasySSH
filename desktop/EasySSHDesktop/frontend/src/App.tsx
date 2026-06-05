import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react"
import type { ReactNode } from "react"
import { Browser, Events, Window } from "@wailsio/runtime"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Activity,
  BrowserRouter,
  CompletionConfigProvider,
  DashboardHeaderActions,
  DEFAULT_SYSTEM_CONFIG,
  FolderOpen,
  Info,
  Menu,
  Minus,
  RefreshCw,
  SidebarProvider,
  Square,
  SshWorkspace,
  StaticSystemConfigProvider,
  TerminalComponent,
  Terminal,
  ThemeProvider,
  Toaster,
  X,
  createBrowserWorkspacePreferenceAdapter,
  createTerminalWorkspaceSessionControllerAdapter,
  createTerminalWorkspaceSessionStoreAdapter,
  createWorkspaceAdapters,
  createWorkspaceCapabilitiesFromRuntime,
  createWorkspaceI18nAdapter,
  createWorkspaceSettingsAdapter,
  toast,
  useTerminalStore,
  type RuntimeInfo,
  type Server,
  type ServerConnectionConfigsApi,
  type SshWorkspaceActivityLogAdapter,
  type SshWorkspaceApiClient,
  type TerminalConnectionPhase,
  type TerminalSession,
  type TerminalWebSocketConstructor,
  type WorkspaceActivityLogRecordInput,
  type WorkspaceActivityLogStatus,
} from "@easyssh/ssh-workspace/desktop"
import {
  ActivityLogService,
  DesktopActivityLogStatus,
  DesktopServerAuthMethod,
  DesktopServerService,
  DesktopTerminalService,
  DesktopService,
} from "../bindings/github.com/easyssh/easyssh-desktop"
import type {
  DesktopActivityLogItem,
  DesktopServer,
  DesktopServerInput,
} from "../bindings/github.com/easyssh/easyssh-desktop"

const connectionConfigName = "\u8fde\u63a5\u914d\u7f6e"
const defaultMaxTabs = 50
const defaultInactiveMinutes = 60
const inactiveToastTitle = "\u7ec8\u7aef\u957f\u65f6\u95f4\u672a\u6d3b\u52a8"
const inactiveToastCloseLabel = "\u5173\u95ed"
const windowActionErrorMessage = "Failed to run window action:"
const desktopActionErrorMessage = "\u684c\u9762\u8bbe\u7f6e\u64cd\u4f5c\u5931\u8d25"
const desktopSettingsLabel = "\u8bbe\u7f6e"
const terminalSettingsLabel = "\u7ec8\u7aef\u8bbe\u7f6e"
const activityLogLabel = "\u6d3b\u52a8\u8bb0\u5f55"
const openDataDirLabel = "\u6253\u5f00\u6570\u636e\u76ee\u5f55"
const aboutDesktopLabel = "\u5173\u4e8e EasySSH"
const aboutDesktopTitle = "\u5173\u4e8e EasySSH Desktop"
const recentActivityDescription = "\u6700\u8fd1 50 \u6761\u684c\u9762\u7aef\u8fde\u63a5\u4e0e\u64cd\u4f5c\u8bb0\u5f55"
const noActivityLabel = "\u6682\u65e0\u6d3b\u52a8\u8bb0\u5f55"
const loadingLabel = "\u52a0\u8f7d\u4e2d..."
const refreshLabel = "\u5237\u65b0"
const dataDirOpenFailedMessage = "\u6253\u5f00\u6570\u636e\u76ee\u5f55\u5931\u8d25"
const windowMinimizeLabel = "\u6700\u5c0f\u5316"
const windowMaximizeLabel = "\u6700\u5927\u5316"
const windowCloseLabel = "\u5173\u95ed"
const desktopVersionLabel = "\u7248\u672c"
const desktopPlatformLabel = "\u5e73\u53f0"
const desktopArchLabel = "\u67b6\u6784"
const desktopDataDirLabel = "\u6570\u636e\u76ee\u5f55"
const desktopUnknownLabel = "\u672a\u77e5"
const githubLabel = "GitHub"
const githubUrl = "https://github.com/shan-hee/EasySSH"

function formatMaxTabsMessage(maxTabs: number) {
  return `\u6700\u591a\u53ea\u80fd\u6253\u5f00 ${maxTabs} \u4e2a\u6807\u7b7e`
}

function formatInactiveToastDescription(sessionName: string, inactiveMinutes: number) {
  return `${sessionName} \u5df2\u8d85\u8fc7 ${inactiveMinutes} \u5206\u949f\u672a\u6d3b\u52a8`
}

function formatDesktopDateTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", { hour12: false })
}

function formatDesktopDuration(milliseconds?: number) {
  if (!milliseconds) return "-"
  if (milliseconds < 1000) return `${milliseconds}ms`
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatDesktopStatus(status: DesktopActivityLogStatus) {
  if (status === DesktopActivityLogStatus.DesktopActivityLogFailure) return "\u5931\u8d25"
  if (status === DesktopActivityLogStatus.DesktopActivityLogWarning) return "\u8b66\u544a"
  return "\u6210\u529f"
}

function formatDesktopAction(action: string) {
  switch (action) {
    case "ssh_connect":
      return "SSH \u8fde\u63a5"
    case "ssh_disconnect":
      return "SSH \u65ad\u5f00"
    case "sftp_upload":
      return "SFTP \u4e0a\u4f20"
    case "sftp_download":
      return "SFTP \u4e0b\u8f7d"
    case "sftp_delete":
      return "SFTP \u5220\u9664"
    case "sftp_rename":
      return "SFTP \u91cd\u547d\u540d"
    case "sftp_mkdir":
      return "SFTP \u65b0\u5efa\u76ee\u5f55"
    case "monitoring_query":
      return "\u76d1\u63a7\u67e5\u8be2"
    default:
      return action || "-"
  }
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

function mapDesktopServer(server: DesktopServer): Server {
  return {
    id: server.id,
    user_id: server.user_id || "local",
    name: server.name || undefined,
    host: server.host,
    port: server.port || 22,
    username: server.username,
    auth_method: server.auth_method === DesktopServerAuthMethod.DesktopServerAuthKey ? "key" : "password",
    password: server.password || undefined,
    private_key: server.private_key || undefined,
    group: server.group || undefined,
    tags: server.tags || [],
    status: server.status === "online" ? "online" : "offline",
    last_connected: server.last_connected || undefined,
    description: server.description || undefined,
    created_at: server.created_at,
    updated_at: server.updated_at,
  }
}

function mapServerInput(input: Parameters<ServerConnectionConfigsApi["create"]>[0]): DesktopServerInput {
  return {
    name: input.name || "",
    host: input.host,
    port: input.port || 22,
    username: input.username,
    auth_method: input.auth_method === "key"
      ? DesktopServerAuthMethod.DesktopServerAuthKey
      : DesktopServerAuthMethod.DesktopServerAuthPassword,
    password: input.password || "",
    private_key: input.private_key || "",
    group: input.group || "",
    tags: input.tags || [],
    description: input.description || "",
  }
}

function createDesktopServerApi(): ServerConnectionConfigsApi {
  return {
    async list(params) {
      const result = await DesktopServerService.List({
        page: params?.page,
        limit: params?.limit,
        group: params?.group,
        search: params?.search,
      })

      return {
        data: (result.data || []).map(mapDesktopServer),
        total: result.total,
        page: result.page,
        limit: result.limit,
      }
    },
    async create(input) {
      return mapDesktopServer(await DesktopServerService.Create(mapServerInput(input)))
    },
    async update(id, input) {
      const current = await DesktopServerService.GetById(id)

      return mapDesktopServer(await DesktopServerService.Update(id, mapServerInput({
        name: input.name ?? current.name ?? "",
        host: input.host ?? current.host,
        port: input.port ?? current.port ?? 22,
        username: input.username ?? current.username,
        auth_method: input.auth_method ?? (current.auth_method === DesktopServerAuthMethod.DesktopServerAuthKey ? "key" : "password"),
        password: input.password ?? current.password ?? "",
        private_key: input.private_key ?? current.private_key ?? "",
        group: input.group ?? current.group ?? "",
        tags: input.tags ?? current.tags ?? [],
        description: input.description ?? current.description ?? "",
      })))
    },
    async delete(id) {
      await DesktopServerService.Delete(id)
    },
    async reorder(serverIds) {
      await DesktopServerService.Reorder(serverIds)
    },
  }
}

function mapActivityLogStatus(status: WorkspaceActivityLogStatus): DesktopActivityLogStatus {
  if (status === "failure") return DesktopActivityLogStatus.DesktopActivityLogFailure
  if (status === "warning") return DesktopActivityLogStatus.DesktopActivityLogWarning
  return DesktopActivityLogStatus.DesktopActivityLogSuccess
}

function mapDesktopActivityLogStatus(status: DesktopActivityLogStatus): WorkspaceActivityLogStatus {
  if (status === DesktopActivityLogStatus.DesktopActivityLogFailure) return "failure"
  if (status === DesktopActivityLogStatus.DesktopActivityLogWarning) return "warning"
  return "success"
}

function mapActivityLogItem(item: DesktopActivityLogItem) {
  return {
    id: item.id,
    action: item.action,
    resource: item.resource,
    status: mapDesktopActivityLogStatus(item.status),
    serverId: item.serverId,
    durationMs: item.durationMs,
    detail: item.detail,
    createdAt: item.createdAt,
  }
}

function mapNumberRecord(record?: Record<string, number | undefined>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(record ?? {})) {
    if (typeof value === "number") {
      result[key] = value
    }
  }
  return result
}

function createDesktopActivityLogAdapter(): SshWorkspaceActivityLogAdapter {
  return {
    async list(params) {
      const result = await ActivityLogService.List({
        page: params?.page,
        limit: params?.limit,
        action: params?.action,
        serverId: params?.serverId,
        status: params?.status ? mapActivityLogStatus(params.status) : undefined,
        startDate: params?.startDate,
        endDate: params?.endDate,
      })

      return {
        items: (result.items || []).map(mapActivityLogItem),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      }
    },
    async getById(id) {
      return mapActivityLogItem(await ActivityLogService.GetById(id))
    },
    async getStatistics(params) {
      const statistics = await ActivityLogService.GetStatistics({
        startDate: params?.startDate,
        endDate: params?.endDate,
      })

      return {
        total: statistics.total,
        successCount: statistics.successCount,
        failureCount: statistics.failureCount,
        byAction: mapNumberRecord(statistics.byAction),
      }
    },
    async record(input: WorkspaceActivityLogRecordInput) {
      return mapActivityLogItem(await ActivityLogService.Record({
        action: input.action,
        resource: input.resource,
        status: mapActivityLogStatus(input.status),
        serverId: input.serverId,
        durationMs: input.durationMs,
        detail: input.detail,
      }))
    },
  }
}

const desktopTerminalOutputEvent = "easyssh:desktop-terminal:output"
const desktopTerminalClosedEvent = "easyssh:desktop-terminal:closed"

interface DesktopTerminalOutputPayload {
  clientId?: string
  data?: string
}

interface DesktopTerminalClosedPayload {
  clientId?: string
  reason?: string
}

const getDesktopEventData = (event: unknown) => {
  return event && typeof event === "object" && "data" in event
    ? (event as { data?: unknown }).data
    : undefined
}

const getDesktopErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
}

const encodeDesktopTerminalInput = (data: string) => {
  const bytes = new TextEncoder().encode(data)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const decodeDesktopTerminalOutput = (data: string) => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

const createDesktopTerminalClientId = () => {
  return `desktop-terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createDesktopTerminalSocket(): TerminalWebSocketConstructor {
  return class DesktopTerminalSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readonly url: string
    readonly extensions = ""
    readonly protocol = ""
    bufferedAmount = 0
    binaryType: BinaryType = "arraybuffer"
    readyState = DesktopTerminalSocket.CONNECTING
    onopen: ((this: WebSocket, ev: Event) => unknown) | null = null
    onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null
    onerror: ((this: WebSocket, ev: Event) => unknown) | null = null
    onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null

    private readonly serverId: string
    private readonly clientId = createDesktopTerminalClientId()
    private readonly cols: number
    private readonly rows: number
    private destroyed = false
    private readonly disposeOutput: () => void
    private readonly disposeClosed: () => void

    constructor(url: string | URL) {
      super()
      this.url = String(url)
      const params = new URL(this.url, window.location.href).searchParams
      this.serverId = params.get("serverId") || ""
      this.cols = Number(params.get("cols")) || 80
      this.rows = Number(params.get("rows")) || 24

      this.disposeOutput = Events.On(desktopTerminalOutputEvent, (event) => {
        const data = getDesktopEventData(event) as DesktopTerminalOutputPayload | undefined
        if (!data || data.clientId !== this.clientId || !data.data) {
          return
        }

        try {
          this.emitMessage(decodeDesktopTerminalOutput(data.data))
        } catch (error) {
          this.emitError(getDesktopErrorMessage(error))
        }
      })

      this.disposeClosed = Events.On(desktopTerminalClosedEvent, (event) => {
        const data = getDesktopEventData(event) as DesktopTerminalClosedPayload | undefined
        if (!data || data.clientId !== this.clientId) {
          return
        }

        this.close(1000, data.reason || "remote closed")
      })

      window.setTimeout(() => {
        void this.start()
      }, 0)
    }

    close(code = 1000, reason = "closed") {
      if (this.readyState === DesktopTerminalSocket.CLOSED) return
      this.destroyed = true
      this.readyState = DesktopTerminalSocket.CLOSED
      this.disposeOutput()
      this.disposeClosed()
      void DesktopTerminalService.Close({ clientId: this.clientId }).catch(() => {})
      const event = new CloseEvent("close", { code, reason, wasClean: code === 1000 })
      this.onclose?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== DesktopTerminalSocket.OPEN) return
      if (typeof data === "string") {
        this.handleControlMessage(data)
        return
      }

      void DesktopTerminalService.Write({
        clientId: this.clientId,
        data: encodeDesktopTerminalInput(this.decodeInput(data)),
      }).catch((error) => this.emitError(getDesktopErrorMessage(error)))
    }

    private handleControlMessage(raw: string) {
      try {
        const message = JSON.parse(raw) as { type?: string; data?: unknown }
        if (message.type === "ping") {
          const now = Date.now()
          const data = message.data && typeof message.data === "object"
            ? message.data as Record<string, unknown>
            : {}
          this.emitControl("pong", {
            ...data,
            serverRecvTs: now,
            serverSendTs: now,
          })
          return
        }
        if (message.type === "resize") {
          const data = message.data && typeof message.data === "object"
            ? message.data as { cols?: number; rows?: number }
            : {}
          void DesktopTerminalService.Resize({
            clientId: this.clientId,
            cols: data.cols || this.cols,
            rows: data.rows || this.rows,
          }).catch((error) => this.emitError(getDesktopErrorMessage(error)))
          return
        }
        if (message.type === "fetch_completion_data") {
          this.emitControl("completion_data", {
            history: [],
            scripts: [],
            timestamp: Date.now(),
          })
          return
        }
        if (message.type === "completion_update") {
          return
        }
      } catch {
        // Ignore non-control strings.
      }
    }

    private async start() {
      if (this.destroyed) return

      this.readyState = DesktopTerminalSocket.OPEN
      this.emitOpen()
      this.emitControl("handshake_complete")

      try {
        await DesktopTerminalService.Start({
          clientId: this.clientId,
          serverId: this.serverId,
          cols: this.cols,
          rows: this.rows,
        })

        if (this.destroyed) return

        this.emitControl("connected")
        void ActivityLogService.Record({
          action: "ssh_connect",
          resource: this.serverId,
          status: DesktopActivityLogStatus.DesktopActivityLogSuccess,
          serverId: this.serverId,
        }).catch((error) => console.error("Failed to record desktop terminal activity:", error))
      } catch (error) {
        const message = getDesktopErrorMessage(error)
        this.emitControl("error", {
          error: "initialization_failed",
          message,
        })
        void ActivityLogService.Record({
          action: "ssh_connect",
          resource: this.serverId,
          status: DesktopActivityLogStatus.DesktopActivityLogFailure,
          serverId: this.serverId,
          detail: message,
        }).catch((error) => console.error("Failed to record desktop terminal activity:", error))
        this.close(1011, message)
      }
    }

    private emitOpen() {
      const event = new Event("open")
      this.onopen?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    private emitControl(type: string, data?: unknown) {
      this.emitMessage(JSON.stringify({ type, data }))
    }

    private emitError(message: string) {
      this.emitControl("error", {
        error: "terminal_io_failed",
        message,
      })
    }

    private emitMessage(data: string | ArrayBuffer) {
      const event = new MessageEvent("message", { data })
      this.onmessage?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    private decodeInput(data: ArrayBufferLike | Blob | ArrayBufferView) {
      if (data instanceof Blob) return ""
      if (ArrayBuffer.isView(data)) {
        return new TextDecoder().decode(data)
      }
      return new TextDecoder().decode(data)
    }
  } as unknown as TerminalWebSocketConstructor
}

function createDesktopRuntime(runtime: Awaited<ReturnType<typeof DesktopService.RuntimeInfo>> | null): RuntimeInfo {
  const runtimeCapabilities: RuntimeInfo["capabilities"] = runtime?.capabilities ?? {}

  return {
    profile: "desktop",
    principal: {
      kind: "local_owner",
      role: "owner",
    },
    single_user: true,
    portable: false,
    managed: false,
    data_dir: runtime?.dataDir,
    version: runtime?.version,
    capabilities: {
      ...runtimeCapabilities,
      servers: runtimeCapabilities.servers ?? true,
      terminal: runtimeCapabilities.terminal ?? true,
      sftp: false,
      transfers: false,
      monitoring: false,
      docker: false,
      ai: false,
      activity_log: runtimeCapabilities.activity_log ?? true,
      settings: runtimeCapabilities.settings ?? true,
      desktop_data_dir: runtimeCapabilities.desktop_data_dir ?? true,
      open_data_dir: runtimeCapabilities.open_data_dir ?? true,
      portable_mode: runtimeCapabilities.portable_mode ?? false,
    },
  }
}

function DesktopProviders({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="system" enableSystem disableTransitionOnChange>
        <StaticSystemConfigProvider
          config={{
            ...DEFAULT_SYSTEM_CONFIG,
            system_name: "EasySSH Desktop",
          }}
        >
          <CompletionConfigProvider>
            <SidebarProvider defaultOpen={false} className="easyssh-desktop-sidebar-context">
              {children}
            </SidebarProvider>
          </CompletionConfigProvider>
        </StaticSystemConfigProvider>
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </BrowserRouter>
  )
}

function runWindowAction(action: () => Promise<void>) {
  void action().catch((error) => {
    console.error(windowActionErrorMessage, error)
  })
}

function DesktopActivityLogDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [items, setItems] = useState<DesktopActivityLogItem[]>([])
  const [loading, setLoading] = useState(false)

  const loadItems = useCallback(async () => {
    try {
      setLoading(true)
      const result = await ActivityLogService.List({ page: 1, limit: 50 })
      setItems(result.items || [])
    } catch (error) {
      console.error(desktopActionErrorMessage, error)
      toast.error(desktopActionErrorMessage)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void loadItems()
    }
  }, [loadItems, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="easyssh-desktop-activity-dialog">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                {activityLogLabel}
              </DialogTitle>
              <DialogDescription>{recentActivityDescription}</DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" title={refreshLabel} aria-label={refreshLabel} onClick={() => void loadItems()} disabled={loading}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        </DialogHeader>

        <div className="easyssh-desktop-activity-list scrollbar-custom">
          {loading && items.length === 0 ? (
            <div className="easyssh-desktop-empty-state">{loadingLabel}</div>
          ) : items.length === 0 ? (
            <div className="easyssh-desktop-empty-state">{noActivityLabel}</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="easyssh-desktop-activity-item">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-medium">{formatDesktopAction(item.action)}</div>
                  <span className="easyssh-desktop-status-badge">{formatDesktopStatus(item.status)}</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground" title={item.resource}>
                  {item.resource || "-"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatDesktopDateTime(item.createdAt)}</span>
                  <span>{formatDesktopDuration(item.durationMs)}</span>
                  {item.serverId ? <span>ID: {item.serverId}</span> : null}
                </div>
                {item.detail ? (
                  <div className="mt-2 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                    {item.detail}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DesktopAboutDialog({
  open,
  onOpenChange,
  runtime,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  runtime: Awaited<ReturnType<typeof DesktopService.RuntimeInfo>> | null
}) {
  const rows = [
    [desktopVersionLabel, runtime?.version || desktopUnknownLabel],
    [desktopPlatformLabel, runtime?.platform || desktopUnknownLabel],
    [desktopArchLabel, runtime?.arch || desktopUnknownLabel],
    [desktopDataDirLabel, runtime?.dataDir || desktopUnknownLabel],
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="easyssh-desktop-about-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            {aboutDesktopTitle}
          </DialogTitle>
          <DialogDescription>EasySSH Desktop</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="easyssh-desktop-about-row">
              <span className="text-muted-foreground">{label}</span>
              <span className="min-w-0 truncate font-medium" title={value}>{value}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => void Browser.OpenURL(githubUrl)}>
            {githubLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DesktopSettingsMenu({
  runtime,
  onOpenTerminalSettings,
}: {
  runtime: Awaited<ReturnType<typeof DesktopService.RuntimeInfo>> | null
  onOpenTerminalSettings: () => void
}) {
  const [activityLogOpen, setActivityLogOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const handleOpenDataDir = useCallback(() => {
    void DesktopService.OpenDataDir().catch((error) => {
      console.error(desktopActionErrorMessage, error)
      toast.error(dataDirOpenFailedMessage)
    })
  }, [])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="easyssh-desktop-titlebar-menu-button"
            aria-label={desktopSettingsLabel}
            title={desktopSettingsLabel}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="easyssh-desktop-settings-menu">
          <DropdownMenuLabel>{desktopSettingsLabel}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenTerminalSettings}>
            <Terminal className="h-4 w-4" />
            <span>{terminalSettingsLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setActivityLogOpen(true)}>
            <Activity className="h-4 w-4" />
            <span>{activityLogLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleOpenDataDir}>
            <FolderOpen className="h-4 w-4" />
            <span>{openDataDirLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAboutOpen(true)}>
            <Info className="h-4 w-4" />
            <span>{aboutDesktopLabel}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DesktopActivityLogDialog open={activityLogOpen} onOpenChange={setActivityLogOpen} />
      <DesktopAboutDialog open={aboutOpen} onOpenChange={setAboutOpen} runtime={runtime} />
    </>
  )
}

function DesktopTitleBar({
  runtime,
  onOpenTerminalSettings,
}: {
  runtime: Awaited<ReturnType<typeof DesktopService.RuntimeInfo>> | null
  onOpenTerminalSettings: () => void
}) {
  const handleMinimize = useCallback(() => {
    runWindowAction(() => Window.Minimise())
  }, [])

  const handleMaximize = useCallback(() => {
    runWindowAction(() => Window.ToggleMaximise())
  }, [])

  const handleClose = useCallback(() => {
    runWindowAction(() => Window.Close())
  }, [])

  return (
    <header className="easyssh-desktop-titlebar">
      <div className="easyssh-desktop-titlebar-drag">
        <img className="easyssh-desktop-titlebar-icon" src="/favicon.ico" alt="" aria-hidden="true" />
        <span className="easyssh-desktop-titlebar-title">EasySSH</span>
      </div>
      <div className="easyssh-desktop-titlebar-actions">
        <DesktopSettingsMenu runtime={runtime} onOpenTerminalSettings={onOpenTerminalSettings} />
        <DashboardHeaderActions />
        <div className="easyssh-desktop-window-controls" role="group" aria-label="Window controls">
          <button
            type="button"
            className="easyssh-desktop-window-button"
            aria-label={windowMinimizeLabel}
            title={windowMinimizeLabel}
            onClick={handleMinimize}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="easyssh-desktop-window-button"
            aria-label={windowMaximizeLabel}
            title={windowMaximizeLabel}
            onClick={handleMaximize}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="easyssh-desktop-window-button easyssh-desktop-window-button-close"
            aria-label={windowCloseLabel}
            title={windowCloseLabel}
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  )
}

function App() {
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof DesktopService.RuntimeInfo>> | null>(null)
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
  const activityLog = useMemo(() => createDesktopActivityLogAdapter(), [])
  const workspaceSessionStore = useMemo(() => createTerminalWorkspaceSessionStoreAdapter(), [])
  const workspaceSessionController = useMemo(() => createTerminalWorkspaceSessionControllerAdapter(), [])
  const workspacePreferences = useMemo(() => createBrowserWorkspacePreferenceAdapter({ keyPrefix: "easyssh.desktop." }), [])
  const terminalSocket = useMemo(() => createDesktopTerminalSocket(), [])
  const runtimeInfo = useMemo(() => createDesktopRuntime(runtime), [runtime])
  const capabilities = useMemo(() => createWorkspaceCapabilitiesFromRuntime(runtimeInfo, {
    defaults: {
      terminal: true,
      sftp: false,
      transfers: false,
      ai: false,
      monitor: false,
      docker: false,
      activityLog: true,
      fullscreen: true,
      crossSessionDrag: false,
    },
  }), [runtimeInfo])
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
        const current = await DesktopServerService.GetById(serverId)
        await DesktopServerService.Update(serverId, mapServerInput({
          name: current.name ?? "",
          host: current.host,
          port: current.port || 22,
          username: current.username,
          auth_method: authMethod,
          password: authMethod === "password" ? secret : current.password ?? "",
          private_key: authMethod === "key" ? secret : current.private_key ?? "",
          group: current.group ?? "",
          tags: current.tags ?? [],
          description: current.description ?? "",
        }))
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
    DesktopService.RuntimeInfo()
      .then(setRuntime)
      .catch((error) => {
        console.error("Failed to load desktop runtime:", error)
      })
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

    void DesktopServerService.MarkConnected(server.id)
      .catch((error) => console.error("Failed to mark desktop server connected:", error))
    void ActivityLogService.Record({
      action: "ssh_connect",
      resource: `${server.username}@${server.host}:${server.port}`,
      status: DesktopActivityLogStatus.DesktopActivityLogSuccess,
      serverId: server.id,
      detail: "Desktop command terminal opened",
    }).catch((error) => console.error("Failed to record desktop connection activity:", error))
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

  return (
    <DesktopProviders>
      <SshWorkspace adapters={adapters} capabilities={capabilities} layout="desktop">
        <main className="easyssh-desktop-home bg-background text-foreground">
          <DesktopTitleBar
            runtime={runtime}
            onOpenTerminalSettings={() => setTerminalSettingsOpen(true)}
          />
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
        </main>
      </SshWorkspace>
    </DesktopProviders>
  )
}

export default App
