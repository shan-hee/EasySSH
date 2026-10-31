import { Fragment, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { ArrowLeft, ExternalLink, MessageCircle, Plus, Settings2, Trash2 } from "lucide-react"
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
import { chatConnectionsApi, type ChatBindCode, type ChatConnection, type ChatConnectionInput, type ChatSession } from "@/lib/api/chat-connections"
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
  const session = sessions.data?.find(item => item.id === sessionId) ?? sessions.data?.[0]
  const managed = connections.data?.find(item => item.id === managing)
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.chatConnections.root }) }
  if (!web) return <p className="p-4 text-sm text-muted-foreground">{t("webOnly")}</p>
  return <>
    <PageHeader title={t("title")} />
    <DashboardPageContent className="min-h-0">
      {connections.isPending && <PageLoading />}
      {connections.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">{t("loadFailed")}<Button variant="outline" size="sm" onClick={() => void connections.refetch()}>{t("retry")}</Button></div>}
      {connections.data?.length === 0 && <section className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center"><MessageCircle className="size-7 text-muted-foreground" /><p className="text-sm font-medium">{t("empty")}</p><p className="max-w-md text-sm text-muted-foreground">{t("emptyHelp")}</p><Button variant="outline" size="sm" onClick={() => setEditor("new")}>{t("create")}</Button></section>}
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
            {sessions.isPending && <PageLoading className="min-h-0 py-8" />}
            {sessions.data?.length === 0 && <div className="space-y-3 p-4 text-sm text-muted-foreground"><p>{t("noSessions")}</p><Button size="sm" variant="outline" onClick={() => setManaging(connection.id)}>{t("generateCode")}</Button></div>}
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

function ConnectionForm({ connection, onSaved }: { connection?: ChatConnection; onSaved: (value: ChatConnection) => Promise<void> }) {
  const { t } = useTranslation("chatConnections")
  const [provider, setProvider] = useState<Provider>(connection?.provider ?? "telegram")
  const [name, setName] = useState(connection?.name ?? "")
  const [token, setToken] = useState("")
  const [appId, setAppId] = useState(connection?.app_id ?? "")
  const [mode, setMode] = useState<ChatConnectionInput["permission_mode"]>(connection?.permission_mode ?? "readonly")
  const [serverIds, setServerIds] = useState<string[]>(connection?.server_ids ?? [])
  const [enabled, setEnabled] = useState(connection?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const sources = useQuery({ queryKey: queryKeys.chatConnections.servers, queryFn: () => loadAllServers(params => serversApi.list(params)) })
  const selectedServerIds = serverIds.filter(id => sources.data?.some(server => server.id === id))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError("")
    try {
      // Each platform accepts only its own credential fields.
      const credentials = provider === "feishu" ? { app_id: appId.trim(), app_secret: token.trim() } : { token: token.trim() }
      const value = await chatConnectionsApi.save(connection?.id, { provider, name: name.trim(), ...credentials, permission_mode: mode, server_ids: selectedServerIds, enabled })
      setToken("")
      await onSaved(value)
    } catch (error) { setError(getErrorMessage(error, t("saveFailed"))) } finally { setBusy(false) }
  }
  const valid = !!name.trim() && new TextEncoder().encode(name.trim()).length <= 100 && (!!connection || (!!token.trim() && (provider === "telegram" || !!appId.trim()))) && selectedServerIds.length > 0 && selectedServerIds.length <= 100 && sources.isSuccess
  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => void submit(event)}>
    <DialogHeader className="shrink-0 border-b p-6 pr-12"><DialogTitle>{connection ? t("edit") : t("create")}</DialogTitle><DialogDescription>{t(`setupHelp.${provider}`)}</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
      {!connection && <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("platform")}>
        {(["telegram", "feishu"] as const).map(item => <button key={item} type="button" role="radio" aria-checked={provider === item} onClick={() => { setProvider(item); setToken("") }}
          className={cn("rounded-lg border px-3 py-2 text-sm transition-colors", provider === item ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50")}>{t(`providers.${item}`)}</button>)}
      </div>}
      <div className="space-y-2"><Label htmlFor="chat-name">{t("name")}</Label><Input id="chat-name" value={name} onChange={event => setName(event.target.value)} required maxLength={100} placeholder={t("namePlaceholder")} /></div>
      {provider === "telegram"
        ? <div className="space-y-2"><Label htmlFor="chat-token">Bot Token</Label><Input id="chat-token" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} required={!connection} placeholder={connection ? t("keepToken") : "123456:…"} /><p className="text-xs text-muted-foreground">{t("tokenHelp")} <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline">@BotFather</a></p></div>
        : <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* The application identifies the connection; switching apps needs a new connection. */}
            <div className="space-y-2"><Label htmlFor="chat-app-id">App ID</Label><Input id="chat-app-id" value={appId} onChange={event => setAppId(event.target.value)} required disabled={!!connection} placeholder="cli_…" /></div>
            <div className="space-y-2"><Label htmlFor="chat-app-secret">App Secret</Label><Input id="chat-app-secret" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} required={!connection} placeholder={connection ? t("keepSecret") : ""} /></div>
          </div>
          <p className="text-xs text-muted-foreground">{t("feishuHelp")} <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer" className="underline">{t("feishuConsole")}</a></p>
        </div>}
      <div className="space-y-2"><Label htmlFor="chat-mode">{t("permissionMode")}</Label><Select value={mode} onValueChange={value => setMode(value as ChatConnectionInput["permission_mode"])}><SelectTrigger id="chat-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="readonly">{t("modes.readonly")}</SelectItem><SelectItem value="balanced">{t("modes.balanced")}</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{t(`modeHelp.${mode}`)}</p></div>
      <div className="space-y-2"><Label>{t("servers")}</Label><p className="text-xs text-muted-foreground">{t("serversHelp")}</p>
        {sources.isError && <div role="alert" className="text-sm text-destructive">{t("loadFailed")}<Button type="button" variant="link" size="sm" onClick={() => void sources.refetch()}>{t("retry")}</Button></div>}
        {sources.isSuccess && !sources.data.length ? <p className="text-sm text-muted-foreground">{t("noServers")}</p>
          : <ServerScopePicker servers={sources.data ?? []} value={selectedServerIds} loading={sources.isPending} disabled={busy || !sources.isSuccess} onChange={setServerIds} />}
      </div>
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
  const [bindCode, setBindCode] = useState<ChatBindCode | null>(null)
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
  const codeExpired = !!bindCode && Date.parse(bindCode.expires_at) <= Date.now()
  return <div className="min-w-0 space-y-4">
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex items-center gap-2 text-sm"><Switch checked={connection.enabled} disabled={busy} onCheckedChange={enabled => void run(async () => { await chatConnectionsApi.setEnabled(id, enabled); setBindCode(null) })} />{t("enabled")}</label>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(connection)}><Settings2 className="size-4" />{t("edit")}</Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void run(async () => { if (await confirm({ description: t("deleteConfirm"), variant: "destructive" })) { await chatConnectionsApi.remove(id); onDeleted() } })}><Trash2 className="size-4" />{t("delete")}</Button>
      </div>
      {connection.last_error && <p role="alert" className="text-sm text-destructive">{connection.last_error}</p>}
    </section>
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{t("bindings")}</h3><Button size="sm" variant="outline" disabled={busy || !connection.enabled} onClick={() => void run(async () => setBindCode(await chatConnectionsApi.bindCode(id)))}>{t("generateCode")}</Button></div>
      <p className="text-xs text-muted-foreground">{t("bindingHelp")}</p>
      {bindCode && connection.enabled && <div className="space-y-2 rounded-md bg-muted p-3"><p className="text-xs">{codeExpired ? t("codeExpired") : t("codeExpires", { time: new Date(bindCode.expires_at).toLocaleTimeString() })}</p>{!codeExpired && <><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs">{bindCode.command ?? `/bind ${bindCode.code}`}</code><CopyButton value={bindCode.command ?? `/bind ${bindCode.code}`} label={t("copyCode")} /></div>{connection.provider === "feishu" && <p className="text-xs text-muted-foreground">{t("feishuBindHint")}</p>}<a className="inline-flex items-center gap-1 text-sm underline" href={bindCode.url} target="_blank" rel="noreferrer">{t(connection.provider === "feishu" ? "openFeishu" : "openTelegram")}<ExternalLink className="size-3" /></a></>}</div>}
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
