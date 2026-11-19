import { Fragment, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { ArrowLeft, BotMessageSquare, Check, ExternalLink, Plus, Settings2, Trash2, Users, X } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { CopyButton } from "@/components/automation/mcp-connection"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { chatConnectionsApi, type ChatBindRequest, type ChatConnection, type ChatConnectionInput, type ChatSession } from "@/lib/api/chat-connections"
import { SystemPromptEditor, systemPromptValid } from "@/components/chat-connections/system-prompt-editor"
import { serversApi } from "@/lib/api/servers"
import { ServerScopePicker } from "@/components/servers/server-scope-picker"
import { getErrorMessage } from "@/lib/error-utils"
import { loadAllServers } from "@/lib/server-utils"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { useRuntime } from "@/shell/runtime"
import { PageLoading } from "@/components/page-loading"

export default function ChatConnectionsPage() {
  const { t } = useTranslation("chatConnections")
  const { runtime } = useRuntime()
  const queryClient = useQueryClient()
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [managing, setManaging] = useState<string | null>(null)
  const [editor, setEditor] = useState<ChatConnection | "new" | null>(null)
  // Narrow screens show either the list or the conversation.
  const [mobileChat, setMobileChat] = useState(false)
  const sidebar = useSidebarWidth()
  const web = runtime?.profile === "web"
  const connections = useQuery({ queryKey: queryKeys.chatConnections.list, queryFn: chatConnectionsApi.list, enabled: web, refetchInterval: 5000 })
  const connection = connections.data?.find(item => item.id === connectionId) ?? connections.data?.[0]
  const sessions = useQuery({ queryKey: queryKeys.chatConnections.sessions(connection?.id ?? ""), queryFn: () => chatConnectionsApi.sessions(connection!.id), enabled: !!connection, refetchInterval: 5000 })
  const detail = useQuery({ queryKey: queryKeys.chatConnections.detail(connection?.id ?? ""), queryFn: () => chatConnectionsApi.detail(connection!.id), enabled: !!connection, refetchInterval: 5000 })
  const requests = detail.data?.requests ?? []
  const session = sessions.data?.find(item => item.id === sessionId) ?? sessions.data?.[0]
  const managed = connections.data?.find(item => item.id === managing)
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.chatConnections.root }) }
  if (!web) return <p className="p-4 text-sm text-muted-foreground">{t("webOnly")}</p>
  return <>
    <PageHeader title={t("title")} />
    <DashboardPageContent className="min-h-0">
      {connections.isPending && <PageLoading />}
      {connections.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">{t("loadFailed")}<Button variant="outline" size="sm" onClick={() => void connections.refetch()}>{t("retry")}</Button></div>}
      {connections.data?.length === 0 && <section className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center"><BotMessageSquare className="size-7 text-muted-foreground" /><p className="text-sm font-medium">{t("empty")}</p><p className="max-w-md text-sm text-muted-foreground">{t("emptyHelp")}</p><Button variant="outline" size="sm" onClick={() => setEditor("new")}>{t("create")}</Button></section>}
      {connection && <div ref={sidebar.container} className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-card" style={{ "--chat-sidebar": `${sidebar.width}px` } as CSSProperties}>
        <aside className={cn("relative w-full shrink-0 flex-col border-r md:flex md:w-[var(--chat-sidebar)]", mobileChat ? "hidden" : "flex")}>
          <div className="space-y-1.5 border-b p-3">
            <div className="flex items-center gap-2">
              <Select value={connection.id} onValueChange={value => {
                if (value === NEW_CONNECTION) return setEditor("new")
                setConnectionId(value); setSessionId(null)
              }}>
                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={t("connection")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {connections.data?.map(item => <SelectItem key={item.id} value={item.id}><StatusDot status={item.status} />{item.name}<span className="text-xs text-muted-foreground">{t(`providers.${item.provider}`)}</span></SelectItem>)}
                  <SelectSeparator />
                  <SelectItem value={NEW_CONNECTION}><Plus className="size-4" />{t("create")}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon-sm" aria-label={t("manage")} title={t("manage")} onClick={() => setManaging(connection.id)}><Settings2 className="size-4" /></Button>
            </div>
            <p className="truncate px-1 text-xs text-muted-foreground">{botLabel(connection)} · {t(`connectionStatus.${connection.status}`)}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {requests.length > 0 && <BindRequests connection={connection} requests={requests} />}
            {sessions.isPending && <PageLoading className="min-h-0 py-8" />}
            {sessions.data?.length === 0 && requests.length === 0 && <Invite connection={connection} />}
            {sessions.data?.map(item => <button type="button" key={item.id} onClick={() => { setSessionId(item.id); setMobileChat(true) }}
              className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60", item.id === session?.id && "bg-muted")}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-medium text-sky-700 dark:text-sky-300">{initial(item.display_name)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium">{item.display_name || t("unnamed")}</span><time className="shrink-0 text-[11px] text-muted-foreground">{shortTime(item.updated_at)}</time></span>
                <span className="block truncate text-xs text-muted-foreground">{busyStatuses.has(item.status) ? t(`sessionStatus.${item.status}`) : item.preview}</span>
              </span>
            </button>)}
          </div>
          <div role="separator" aria-orientation="vertical" tabIndex={0} aria-label={t("resizeSidebar")}
            aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} aria-valuenow={sidebar.width}
            className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none md:block"
            {...sidebar.handle} />
        </aside>
        <div className={cn("min-w-0 flex-1 md:flex", mobileChat ? "flex" : "hidden")}>
          {session ? <ChatTranscript key={`${connection.id}:${session.id}`} connection={connection} session={session} onBack={() => setMobileChat(false)} /> : <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">{t("selectSession")}</div>}
        </div>
      </div>}
    </DashboardPageContent>
    <Dialog open={managed !== undefined} onOpenChange={open => { if (!open) setManaging(null) }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{managed?.name ?? t("title")}</DialogTitle>
          <DialogDescription>{managed ? `${t(`providers.${managed.provider}`)} · ${botLabel(managed)} · ${t(`connectionStatus.${managed.status}`)}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {managed && <ConnectionDetail key={managed.id} id={managed.id} onEdit={setEditor} onDeleted={() => setManaging(null)} />}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={editor !== null} onOpenChange={open => { if (!open) setEditor(null) }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {editor !== null && <ConnectionForm key={editor === "new" ? "new" : editor.id} connection={editor === "new" ? undefined : editor} onSaved={async value => { setEditor(null); setConnectionId(value.id); await refresh() }} />}
      </DialogContent>
    </Dialog>
  </>
}

const NEW_CONNECTION = "__new"
const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 480
const SIDEBAR_KEY = "easyssh.chat-connections.sidebar-width"

// Drag or arrow keys resize the session list; the conversation keeps at least 360px.
function useSidebarWidth() {
  const container = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; width: number } | null>(null)
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_KEY))
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 288
  })
  const clamp = (value: number) => Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, (container.current?.clientWidth ?? Infinity) - 360, value)))
  const commit = (value: number) => { setWidth(value); localStorage.setItem(SIDEBAR_KEY, String(value)) }
  const handle = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      start.current = { x: event.clientX, width }
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (start.current) setWidth(clamp(start.current.width + event.clientX - start.current.x))
    },
    onPointerUp: () => {
      if (!start.current) return
      start.current = null
      commit(width)
    },
    onPointerCancel: () => { start.current = null },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0
      if (!step) return
      event.preventDefault()
      commit(clamp(width + step))
    },
  }
  return { container, width, handle }
}

type Provider = ChatConnection["provider"]
// Feishu reports the application name; Telegram reports the bot's @username.
const botLabel = (connection: ChatConnection) => connection.provider === "feishu" ? connection.bot_username : `@${connection.bot_username}`
const botLink = (connection: ChatConnection) => connection.provider === "feishu"
  ? `https://applink.feishu.cn/client/bot/open?appId=${encodeURIComponent(connection.app_id ?? "")}`
  : `https://t.me/${encodeURIComponent(connection.bot_username)}`

// Anyone who messages the bot shows up here; only the owner's click binds them.
function BindRequests({ connection, requests }: { connection: ChatConnection; requests: ChatBindRequest[] }) {
  const { t } = useTranslation("chatConnections")
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (request: ChatBindRequest, approve: boolean) => {
    setBusy(request.id)
    try {
      await (approve ? chatConnectionsApi.approve : chatConnectionsApi.ignore)(connection.id, request.id)
      if (approve) toast.success(t("approved"))
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatConnections.root })
    } catch (error) { toast.error(getErrorMessage(error, t("actionFailed"))) } finally { setBusy(null) }
  }
  return <section className="space-y-2 border-b bg-amber-500/5 p-3">
    <h3 className="text-xs font-medium text-amber-700 dark:text-amber-300" title={t("requestHint")}>{t("requests")} · {requests.length}</h3>
    {requests.map(request => <div key={request.id} className="space-y-2 rounded-md border bg-card p-2.5">
      <div className="flex items-start gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-sm font-medium text-amber-700 dark:text-amber-300">{request.is_group ? <Users className="size-4" /> : initial(request.display_name)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium" title={request.display_name}>{request.display_name}</span><time className="shrink-0 text-[11px] text-muted-foreground">{shortTime(request.updated_at)}</time></p>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={request.account}>{request.account}</p>
          {request.message && <p className="mt-1 line-clamp-2 break-words text-xs">{request.message}</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 flex-1" disabled={busy !== null} onClick={() => void act(request, true)}><Check className="size-3.5" />{t("approve")}</Button>
        <Button size="sm" variant="ghost" className="h-7" disabled={busy !== null} onClick={() => void act(request, false)}><X className="size-3.5" />{t("ignore")}</Button>
      </div>
    </div>)}
  </section>
}

function Invite({ connection }: { connection: ChatConnection }) {
  const { t } = useTranslation("chatConnections")
  return <div className="space-y-3 p-4">
    <p className="text-sm font-medium">{t("inviteTitle")}</p>
    <p className="text-xs text-muted-foreground">{t(`inviteHelp.${connection.provider}`)}</p>
    <Button size="sm" className="w-full" asChild>
      <a href={botLink(connection)} target="_blank" rel="noreferrer">{t(connection.provider === "feishu" ? "openFeishu" : "openTelegram")}<ExternalLink className="size-3.5" /></a>
    </Button>
    <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-primary" />{t("waitingRequest")}</p>
  </div>
}

const busyStatuses = new Set(["running", "waiting_confirmation"])
const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase()
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
const shortTime = (value: string) => {
  const date = new Date(value)
  return sameDay(date, new Date()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString([], { month: "numeric", day: "numeric" })
}

function StatusDot({ status }: { status: ChatConnection["status"] }) {
  return <span className={cn("size-2 shrink-0 rounded-full", status === "connected" ? "bg-emerald-500" : status === "error" ? "bg-destructive" : "bg-muted-foreground/40")} />
}

// Each platform's own look, so the page shows the conversation as the chat app
// does rather than with the AI assistant's message rendering.
const transcriptThemes: Record<Provider, { canvas: string; user: string; bot: string; pill: string }> = {
  telegram: {
    canvas: "bg-[#dfe7ee] dark:bg-[#0e1621]",
    user: "rounded-2xl rounded-br-md bg-[#e2f7cb] shadow-sm dark:bg-[#2b5278]",
    bot: "rounded-2xl rounded-bl-md bg-white shadow-sm dark:bg-[#182533]",
    pill: "bg-black/20 text-white dark:bg-white/10",
  },
  feishu: {
    canvas: "bg-[#f5f6f7] dark:bg-[#1b1b1b]",
    user: "rounded-lg bg-[#cce0ff] dark:bg-[#1f3b70]",
    bot: "rounded-lg border border-[#dee0e3] bg-white dark:border-white/10 dark:bg-[#292929]",
    pill: "bg-black/5 text-[#646a73] dark:bg-white/10 dark:text-white/60",
  },
}

function ChatTranscript({ connection, session, onBack }: { connection: ChatConnection; session: ChatSession; onBack: () => void }) {
  const { t } = useTranslation("chatConnections")
  const bottom = useRef<HTMLDivElement>(null)
  const transcript = useQuery({ queryKey: queryKeys.chatConnections.transcript(connection.id, session.id), queryFn: () => chatConnectionsApi.transcript(connection.id, session.id), refetchInterval: busyStatuses.has(session.status) ? 3000 : 15000 })
  const messages = transcript.data ?? []
  const theme = transcriptThemes[connection.provider]
  const pill = (content: ReactNode) => <p className={cn("mx-auto my-1 rounded-full px-2.5 py-0.5 text-center text-xs", theme.pill)}>{content}</p>
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }) }, [messages.length])
  return <section className="flex min-w-0 flex-1 flex-col">
    <header className="flex items-center gap-3 border-b px-4 py-2.5">
      <Button variant="ghost" size="icon-sm" className="-ml-2 md:hidden" aria-label={t("back")} onClick={onBack}><ArrowLeft className="size-4" /></Button>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-medium text-sky-700 dark:text-sky-300">{initial(session.display_name)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{session.display_name || t("unnamed")}</p>
        <p className="truncate text-xs text-muted-foreground">{botLabel(connection)}{busyStatuses.has(session.status) ? ` · ${t(`sessionStatus.${session.status}`)}` : ""}</p>
      </div>
      <Button size="sm" variant="ghost" asChild><Link to={`/dashboard/ai-assistant?session=${encodeURIComponent(session.id)}`}>{t("openSession")}<ExternalLink className="size-3" /></Link></Button>
    </header>
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3", theme.canvas)}>
      <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
        {pill(t("transcriptHint"))}
        {transcript.isPending && <PageLoading className="min-h-0 py-10" />}
        {transcript.isError && pill(t("loadFailed"))}
        {messages.map((message, index) => {
          const at = new Date(message.created_at)
          const user = message.from === "user"
          return <Fragment key={message.id}>
            {(index === 0 || !sameDay(at, new Date(messages[index - 1].created_at))) && pill(at.toLocaleDateString([], { month: "long", day: "numeric" }))}
            <div className={cn("flex", user ? "justify-end" : "justify-start")}>
              <div className="max-w-[min(85%,34rem)]">
                <div className={cn("px-3 py-1.5 text-sm text-[#1f2329] dark:text-white", user ? theme.user : theme.bot)}>
                  <p className="whitespace-pre-wrap break-words">{message.text}<time className="float-right ml-3 mt-1.5 text-[11px] leading-none opacity-50">{at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></p>
                  {/* Feishu puts card buttons inside the card; Telegram shows an inline keyboard below. */}
                  {connection.provider === "feishu" && message.buttons.length > 0 && <div className="mb-1 mt-2 flex flex-wrap gap-2">
                    {message.buttons.map((button, i) => <span key={button} className={cn("rounded-md px-3 py-1 text-xs font-medium", i === 0 ? "bg-[#3370ff] text-white" : "border border-[#f54a45] text-[#f54a45]")}>{button}</span>)}
                  </div>}
                </div>
                {connection.provider === "telegram" && message.buttons.length > 0 && <div className="mt-1 grid grid-cols-2 gap-1">
                  {message.buttons.map(button => <span key={button} className="rounded-lg bg-black/20 px-2 py-1.5 text-center text-xs font-medium text-white dark:bg-white/10">{button}</span>)}
                </div>}
              </div>
            </div>
          </Fragment>
        })}
        <div ref={bottom} />
      </div>
    </div>
  </section>
}

const FEISHU_SCOPES = JSON.stringify({ scopes: { tenant: ["im:message.p2p_msg:readonly", "im:message.group_at_msg:readonly", "im:message:readonly", "im:message:send_as_bot", "contact:user.base:readonly", "im:chat:readonly"], user: [] } }, null, 2)

function FeishuSteps() {
  const { t } = useTranslation("chatConnections")
  const steps: [string, ReactNode][] = [
    ["create", <a key="console" href="https://open.feishu.cn/app" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">{t("feishuConsole")}<ExternalLink className="size-3" /></a>],
    ["scopes", <CopyChip key="scopes" value={FEISHU_SCOPES} label={t("copyScopes")} />],
    ["events", <span key="events" className="flex flex-wrap gap-1.5"><CopyChip value="im.message.receive_v1" label="im.message.receive_v1" /><CopyChip value="card.action.trigger" label="card.action.trigger" /></span>],
    ["publish", null],
  ]
  return <ol className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
    {steps.map(([key, action], index) => <li key={key} className="flex gap-2.5 text-sm">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">{index + 1}</span>
      <div className="min-w-0 flex-1 space-y-1.5"><p>{t(`feishuSteps.${key}`)}</p>{action}</div>
    </li>)}
  </ol>
}

function CopyChip({ value, label }: { value: string; label: string }) {
  return <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background pl-2 font-mono text-xs"><span className="truncate">{label}</span><CopyButton value={value} label={label} className="size-6" /></span>
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-4"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</section>
}

function ConnectionForm({ connection, onSaved }: { connection?: ChatConnection; onSaved: (value: ChatConnection) => Promise<void> }) {
  const { t } = useTranslation("chatConnections")
  const [provider, setProvider] = useState<Provider>(connection?.provider ?? "telegram")
  const [name, setName] = useState(connection?.name ?? "")
  const [token, setToken] = useState("")
  const [appId, setAppId] = useState(connection?.app_id ?? "")
  const [mode, setMode] = useState<ChatConnectionInput["permission_mode"]>(connection?.permission_mode ?? "readonly")
  const [serverIds, setServerIds] = useState<string[]>(connection?.server_ids ?? [])
  const [systemPrompt, setSystemPrompt] = useState(connection?.system_prompt ?? "")
  const [enabled, setEnabled] = useState(connection?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const sources = useQuery({ queryKey: queryKeys.chatConnections.servers, queryFn: () => loadAllServers(params => serversApi.list(params)) })
  const selectedServerIds = serverIds.filter(id => sources.data?.some(server => server.id === id))
  const selectedServers = sources.data?.filter(server => selectedServerIds.includes(server.id)) ?? []
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError("")
    try {
      // Each platform accepts only its own credential fields.
      const credentials = provider === "feishu" ? { app_id: appId.trim(), app_secret: token.trim() } : { token: token.trim() }
      const value = await chatConnectionsApi.save(connection?.id, { provider, name: name.trim(), ...credentials, permission_mode: mode, server_ids: selectedServerIds, system_prompt: systemPrompt, enabled })
      setToken("")
      await onSaved(value)
    } catch (error) { setError(getErrorMessage(error, t("saveFailed"))) } finally { setBusy(false) }
  }
  const valid = !!name.trim() && new TextEncoder().encode(name.trim()).length <= 100 && (!!connection || (!!token.trim() && (provider === "telegram" || !!appId.trim()))) && selectedServerIds.length > 0 && selectedServerIds.length <= 100 && sources.isSuccess && systemPromptValid(systemPrompt, selectedServerIds)
  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => void submit(event)}>
    <DialogHeader className="shrink-0 border-b p-6 pr-12"><DialogTitle>{connection ? t("edit") : t("create")}</DialogTitle><DialogDescription>{t(`setupHelp.${provider}`)}</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-5">
      <FormSection title={t("sections.bot")}>
        {!connection && <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("platform")}>
          {(["telegram", "feishu"] as const).map(item => <button key={item} type="button" role="radio" aria-checked={provider === item} onClick={() => { setProvider(item); setToken("") }}
            className={cn("rounded-lg border px-3 py-2 text-sm transition-colors", provider === item ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50")}>{t(`providers.${item}`)}</button>)}
        </div>}
        {provider === "feishu" && !connection && <FeishuSteps />}
        <div className="space-y-2"><Label htmlFor="chat-name">{t("name")}</Label><Input id="chat-name" value={name} onChange={event => setName(event.target.value)} required maxLength={100} placeholder={t("namePlaceholder")} /></div>
        {provider === "telegram"
          ? <div className="space-y-2">
            <div className="flex items-center justify-between gap-2"><Label htmlFor="chat-token">Bot Token</Label><a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">{t("openBotFather")}<ExternalLink className="size-3" /></a></div>
            <Input id="chat-token" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} required={!connection} placeholder={connection ? t("keepToken") : "123456:…"} />
            <p className="text-xs text-muted-foreground">{t("tokenHelp")}</p>
          </div>
          : <div className="grid gap-3 sm:grid-cols-2">
            {/* The application identifies the connection; switching apps needs a new connection. */}
            <div className="space-y-2"><Label htmlFor="chat-app-id">App ID</Label><Input id="chat-app-id" value={appId} onChange={event => setAppId(event.target.value)} required disabled={!!connection} placeholder="cli_…" /></div>
            <div className="space-y-2"><Label htmlFor="chat-app-secret">App Secret</Label><Input id="chat-app-secret" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} required={!connection} placeholder={connection ? t("keepSecret") : ""} /></div>
          </div>}
      </FormSection>
      <FormSection title={t("sections.access")}>
        <div className="space-y-2"><Label>{t("servers")}</Label><p className="text-xs text-muted-foreground">{t("serversHelp")}</p>
          {sources.isError && <div role="alert" className="text-sm text-destructive">{t("loadFailed")}<Button type="button" variant="link" size="sm" onClick={() => void sources.refetch()}>{t("retry")}</Button></div>}
          {sources.isSuccess && !sources.data.length ? <p className="text-sm text-muted-foreground">{t("noServers")}</p>
            : <ServerScopePicker servers={sources.data ?? []} value={selectedServerIds} loading={sources.isPending} disabled={busy || !sources.isSuccess} onChange={setServerIds} />}
        </div>
        <div className="space-y-2"><Label htmlFor="chat-mode">{t("permissionMode")}</Label><Select value={mode} onValueChange={value => setMode(value as ChatConnectionInput["permission_mode"])}><SelectTrigger id="chat-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="readonly">{t("modes.readonly")}</SelectItem><SelectItem value="balanced">{t("modes.balanced")}</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{t(`modeHelp.${mode}`)}</p></div>
      </FormSection>
      <FormSection title={t("sections.agent")}>
        <div className="space-y-2"><Label htmlFor="chat-prompt">{t("systemPrompt")}</Label>
          <SystemPromptEditor id="chat-prompt" value={systemPrompt} servers={selectedServers} disabled={busy} onChange={setSystemPrompt} />
        </div>
      </FormSection>
      <label className="flex items-center justify-between gap-3 text-sm"><span>{t("enabled")}</span><Switch checked={enabled} onCheckedChange={setEnabled} /></label>
      {connection && <p className="text-xs text-muted-foreground">{t("editStopsWork")}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </fieldset>
    <DialogFooter className="shrink-0 border-t p-4"><Button type="submit" disabled={busy || !valid}>{busy ? t("saving") : t("save")}</Button></DialogFooter>
  </form>
}

function ConnectionDetail({ id, onEdit, onDeleted }: { id: string; onEdit: (connection: ChatConnection) => void; onDeleted: () => void }) {
  const { t } = useTranslation("chatConnections")
  const queryClient = useQueryClient()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [busy, setBusy] = useState(false)
  const detail = useQuery({ queryKey: queryKeys.chatConnections.detail(id), queryFn: () => chatConnectionsApi.detail(id), refetchInterval: 5000 })
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await action(); await queryClient.invalidateQueries({ queryKey: queryKeys.chatConnections.root }) }
    catch (error) { toast.error(getErrorMessage(error, t("actionFailed"))) }
    finally { setBusy(false) }
  }
  if (detail.isPending) return <PageLoading className="min-h-0 py-10" />
  if (detail.isError) return <div role="alert" className="rounded-lg border p-4 text-sm text-destructive">{t("loadFailed")}<Button variant="outline" size="sm" onClick={() => void detail.refetch()}>{t("retry")}</Button></div>
  const { connection, bindings } = detail.data
  return <div className="min-w-0 space-y-4">
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex items-center gap-2 text-sm"><Switch checked={connection.enabled} disabled={busy} onCheckedChange={enabled => void run(() => chatConnectionsApi.setEnabled(id, enabled))} />{t("enabled")}</label>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(connection)}><Settings2 className="size-4" />{t("edit")}</Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void run(async () => { if (await confirm({ description: t("deleteConfirm"), variant: "destructive" })) { await chatConnectionsApi.remove(id); onDeleted() } })}><Trash2 className="size-4" />{t("delete")}</Button>
      </div>
      {connection.last_error && <p role="alert" className="text-sm text-destructive">{connection.last_error}</p>}
    </section>
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{t("bindings")}</h3>
      {bindings.length === 0 && <p className="text-sm text-muted-foreground">{t("noBindings")}</p>}
      {bindings.map(binding => <div key={binding.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div><p className="text-sm">{binding.display_name || binding.user_id}</p><p className="text-xs text-muted-foreground">ID: {binding.external_user_id || binding.user_id} · {binding.revoked_at ? t("revoked") : t("bound")}</p></div>
        <div className="flex gap-2">
          {binding.current_session_id && <Button size="sm" variant="ghost" asChild><Link to={`/dashboard/ai-assistant?session=${encodeURIComponent(binding.current_session_id)}`}>{t("openSession")}<ExternalLink className="size-3" /></Link></Button>}
          {!binding.revoked_at && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { if (await confirm({ description: t("revokeConfirm"), variant: "destructive" })) await chatConnectionsApi.revoke(id, binding.id) })}>{t("revoke")}</Button>}
        </div>
      </div>)}
    </section>
    {confirmDialog}
  </div>
}
