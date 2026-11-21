import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BotMessageSquare,
  Check,
  ExternalLink,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Server as ServerIcon,
  Settings2,
  Shield,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { CopyButton } from "@/components/automation/mcp-connection"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

type Provider = ChatConnection["provider"]
type EditorState =
  | { mode: "new"; provider?: Provider }
  | { mode: "edit"; connection: ChatConnection }
  | null

export default function ChatConnectionsPage() {
  const { t } = useTranslation("chatConnections")
  const { runtime } = useRuntime()
  const queryClient = useQueryClient()
  // null => 渠道卡片墙；有值 => 沉浸式原生聊天气泡舞台
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [managing, setManaging] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  // Narrow screens inside chat view show either the session list or the conversation.
  const [mobileChat, setMobileChat] = useState(false)
  const sidebar = useSidebarWidth()
  const web = runtime?.profile === "web"

  const connections = useQuery({
    queryKey: queryKeys.chatConnections.list,
    queryFn: chatConnectionsApi.list,
    enabled: web,
    refetchInterval: 5000,
  })
  const connectionList = useMemo(() => connections.data ?? [], [connections.data])
  const activeConnection = activeChatId
    ? connectionList.find((item) => item.id === activeChatId) ?? null
    : null
  const managed = connectionList.find((item) => item.id === managing) ?? null

  const sessions = useQuery({
    queryKey: queryKeys.chatConnections.sessions(activeConnection?.id ?? ""),
    queryFn: () => chatConnectionsApi.sessions(activeConnection!.id),
    enabled: Boolean(activeConnection),
    refetchInterval: 5000,
  })
  const detail = useQuery({
    queryKey: queryKeys.chatConnections.detail(activeConnection?.id ?? ""),
    queryFn: () => chatConnectionsApi.detail(activeConnection!.id),
    enabled: Boolean(activeConnection),
    refetchInterval: 5000,
  })
  const requests = detail.data?.requests ?? []
  const session = sessions.data?.find((item) => item.id === sessionId) ?? sessions.data?.[0]

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.chatConnections.root })
  }

  const openChannelChat = (connection: ChatConnection, targetSessionId?: string | null) => {
    setActiveChatId(connection.id)
    setSessionId(targetSessionId ?? null)
    setMobileChat(Boolean(targetSessionId))
  }

  if (!web) return <p className="p-4 text-sm text-muted-foreground">{t("webOnly")}</p>

  const connectedCount = connectionList.filter((item) => item.status === "connected").length

  return (
    <>
      <PageHeader title={t("title")} />
      <DashboardPageContent className={cn("min-h-0", !activeConnection && "overflow-y-auto")}>
        {connections.isPending && <PageLoading />}

        {connections.isError && (
          <div role="alert" className="flex items-center gap-3 rounded-xl border p-4 text-sm text-destructive">
            {t("loadFailed")}
            <Button variant="outline" size="sm" onClick={() => void connections.refetch()}>
              {t("retry")}
            </Button>
          </div>
        )}

        {/* 空状态：Telegram / 飞书双平台直达引导卡片 */}
        {connections.data?.length === 0 && (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 py-8">
            <div className="space-y-2 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BotMessageSquare className="size-6" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">{t("empty")}</h2>
              <p className="mx-auto max-w-lg text-sm text-muted-foreground">{t("emptyHelp")}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {(["telegram", "feishu"] as const).map((provider) => (
                <div
                  key={provider}
                  className="flex flex-col justify-between gap-5 rounded-2xl border bg-card p-5 transition-all hover:border-foreground/20"
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <PlatformAvatar provider={provider} size="lg" />
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{t(`providers.${provider}`)}</h3>
                        <p className="text-xs text-muted-foreground">{t(`platformTagline.${provider}`)}</p>
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">{t(`setupHelp.${provider}`)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={provider === "telegram" ? "default" : "secondary"}
                    className="w-full"
                    onClick={() => setEditor({ mode: "new", provider })}
                  >
                    <Plus className="mr-1.5 size-4" />
                    {t(provider === "telegram" ? "connectTelegram" : "connectFeishu")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 主视图：机器人渠道卡片墙 */}
        {connectionList.length > 0 && !activeConnection && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 font-medium text-foreground tabular-nums">
                  <BotMessageSquare className="size-3.5 text-primary" />
                  {t("summaryTotal", { count: connectionList.length })}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 tabular-nums">
                  <span className={cn("size-1.5 rounded-full", connectedCount > 0 ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                  {t("summaryConnected", { count: connectedCount })}
                </span>
              </div>
              <Button size="sm" onClick={() => setEditor({ mode: "new" })}>
                <Plus className="mr-1.5 size-4" />
                {t("create")}
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {connectionList.map((item) => (
                <BotChannelCard
                  key={item.id}
                  connection={item}
                  onOpenChat={(targetSessionId) => openChannelChat(item, targetSessionId)}
                  onManage={() => setManaging(item.id)}
                  onEdit={() => setEditor({ mode: "edit", connection: item })}
                />
              ))}
            </div>
          </div>
        )}

        {/* 二级视图：沉浸式原生聊天气泡舞台 */}
        {activeConnection && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* 顶部返回与渠道上下文栏 */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 rounded-xl border bg-card px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs"
                  onClick={() => {
                    setActiveChatId(null)
                    setSessionId(null)
                    setMobileChat(false)
                  }}
                >
                  <ArrowLeft className="size-3.5" />
                  <span>{t("backToChannels")}</span>
                </Button>
                <span className="h-4 w-px bg-border" aria-hidden="true" />
                <PlatformAvatar provider={activeConnection.provider} size="sm" />
                <Select
                  value={activeConnection.id}
                  onValueChange={(value) => {
                    if (value === NEW_CONNECTION) return setEditor({ mode: "new" })
                    setActiveChatId(value)
                    setSessionId(null)
                    setMobileChat(false)
                  }}
                >
                  <SelectTrigger size="sm" className="h-8 max-w-[240px] border-none bg-transparent px-1.5 font-medium shadow-none hover:bg-muted/60" aria-label={t("connection")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connectionList.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        <StatusDot status={item.status} />
                        {item.name}
                        <span className="text-xs text-muted-foreground">{t(`providers.${item.provider}`)}</span>
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value={NEW_CONNECTION}>
                      <Plus className="size-4" />
                      {t("create")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <ConnectionStatusPill status={activeConnection.status} />
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                  {botLabel(activeConnection)}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" asChild>
                  <a href={botLink(activeConnection)} target="_blank" rel="noreferrer">
                    <span>{t("openBotShort")}</span>
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 px-2.5 text-xs"
                  onClick={() => setManaging(activeConnection.id)}
                >
                  <Settings2 className="size-3.5" />
                  <span>{t("manage")}</span>
                </Button>
              </div>
            </div>

            {activeConnection.last_error ? (
              <div role="alert" className="flex shrink-0 items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3.5 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span className="break-words">{activeConnection.last_error}</span>
              </div>
            ) : null}

            {/* 原生聊天气泡双栏舞台 */}
            <div
              ref={sidebar.container}
              className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border bg-card"
              style={{ "--chat-sidebar": `${sidebar.width}px` } as CSSProperties}
            >
              <aside className={cn("relative w-full shrink-0 flex-col border-r md:flex md:w-[var(--chat-sidebar)]", mobileChat ? "hidden" : "flex")}>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {requests.length > 0 && <BindRequests connection={activeConnection} requests={requests} />}
                  {sessions.isPending && <PageLoading className="min-h-0 py-8" />}
                  {sessions.data?.length === 0 && requests.length === 0 && <Invite connection={activeConnection} />}
                  {sessions.data?.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setSessionId(item.id)
                        setMobileChat(true)
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-border/50 px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50",
                        item.id === session?.id && "bg-muted/80",
                      )}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-medium text-sky-700 dark:text-sky-300">
                        {initial(item.display_name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{item.display_name || t("unnamed")}</span>
                          <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{shortTime(item.updated_at)}</time>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {busyStatuses.has(item.status) ? t(`sessionStatus.${item.status}`) : item.preview}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  tabIndex={0}
                  aria-label={t("resizeSidebar")}
                  aria-valuemin={SIDEBAR_MIN}
                  aria-valuemax={SIDEBAR_MAX}
                  aria-valuenow={sidebar.width}
                  className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none md:block"
                  {...sidebar.handle}
                />
              </aside>

              <div className={cn("min-w-0 flex-1 md:flex", mobileChat ? "flex" : "hidden")}>
                {session ? (
                  <ChatTranscript
                    key={`${activeConnection.id}:${session.id}`}
                    connection={activeConnection}
                    session={session}
                    onBack={() => setMobileChat(false)}
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                    <MessageSquare className="size-6 opacity-40" />
                    <span>{t("selectSession")}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DashboardPageContent>

      {/* 右侧滑出管理抽屉：启停、绑定账号解绑、编辑与删除 */}
      <Sheet open={managed !== null} onOpenChange={(open) => { if (!open) setManaging(null) }}>
        <SheetContent side="right" className="flex w-[min(520px,95vw)] flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
            <div className="flex items-center gap-2.5">
              {managed ? <PlatformAvatar provider={managed.provider} size="sm" /> : null}
              <SheetTitle className="truncate">{managed?.name ?? t("title")}</SheetTitle>
            </div>
            <SheetDescription className="truncate">
              {managed ? `${t(`providers.${managed.provider}`)} · ${botLabel(managed)} · ${t(`connectionStatus.${managed.status}`)}` : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {managed && (
              <ConnectionDetail
                key={managed.id}
                id={managed.id}
                onEdit={(item) => {
                  setManaging(null)
                  setEditor({ mode: "edit", connection: item })
                }}
                onDeleted={() => {
                  if (activeChatId === managed.id) {
                    setActiveChatId(null)
                    setSessionId(null)
                  }
                  setManaging(null)
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null) }}>
        <DialogContent className="flex h-[min(680px,calc(100dvh-3rem))] w-[min(920px,calc(100vw-2rem))] min-w-0 max-w-none flex-col gap-0 overflow-hidden p-0">
          {editor !== null && (
            <ConnectionForm
              key={editor.mode === "new" ? `new-${editor.provider ?? "telegram"}` : editor.connection.id}
              connection={editor.mode === "edit" ? editor.connection : undefined}
              initialProvider={editor.mode === "new" ? editor.provider : undefined}
              onSaved={async (value) => {
                setEditor(null)
                if (activeChatId) setActiveChatId(value.id)
                await refresh()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function BotChannelCard({
  connection,
  onOpenChat,
  onManage,
  onEdit,
}: {
  connection: ChatConnection
  onOpenChat: (sessionId?: string | null) => void
  onManage: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation("chatConnections")
  const queryClient = useQueryClient()
  const [toggling, setToggling] = useState(false)
  const [requestBusyId, setRequestBusyId] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: queryKeys.chatConnections.detail(connection.id),
    queryFn: () => chatConnectionsApi.detail(connection.id),
    refetchInterval: 10_000,
  })
  const sessions = useQuery({
    queryKey: queryKeys.chatConnections.sessions(connection.id),
    queryFn: () => chatConnectionsApi.sessions(connection.id),
    refetchInterval: 10_000,
  })

  const activeBindings = (detail.data?.bindings ?? []).filter((b) => !b.revoked_at)
  const pendingRequests = detail.data?.requests ?? []
  const sessionList = sessions.data ?? []
  const latestSession = sessionList[0] ?? null
  const hasBusySession = sessionList.some((s) => busyStatuses.has(s.status))

  const handleToggleEnabled = async (enabled: boolean) => {
    if (toggling) return
    setToggling(true)
    try {
      await chatConnectionsApi.setEnabled(connection.id, enabled)
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatConnections.root })
    } catch (error) {
      toast.error(getErrorMessage(error, t("actionFailed")))
    } finally {
      setToggling(false)
    }
  }

  const handleRequestAction = async (request: ChatBindRequest, approve: boolean) => {
    if (requestBusyId) return
    setRequestBusyId(request.id)
    try {
      await (approve ? chatConnectionsApi.approve : chatConnectionsApi.ignore)(connection.id, request.id)
      if (approve) toast.success(t("approved"))
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatConnections.root })
    } catch (error) {
      toast.error(getErrorMessage(error, t("actionFailed")))
    } finally {
      setRequestBusyId(null)
    }
  }

  const firstPending = pendingRequests[0] ?? null

  return (
    <article
      className={cn(
        "flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 transition-all hover:border-foreground/20",
        pendingRequests.length > 0 && "border-amber-500/35",
        connection.status === "error" && "border-destructive/35",
      )}
    >
      <div className="space-y-3.5">
        {/* 顶部：平台品牌头像 + 名称 + 开关 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <PlatformAvatar provider={connection.provider} size="md" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground" title={connection.name}>
                  {connection.name}
                </h3>
                <ConnectionStatusPill status={connection.status} />
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {t(`providers.${connection.provider}`)} · {botLabel(connection)}
              </p>
            </div>
          </div>

          <Switch
            checked={connection.enabled}
            disabled={toggling}
            aria-label={t("enabled")}
            onCheckedChange={(checked) => void handleToggleEnabled(checked)}
          />
        </div>

        {/* 能力与范围标签 */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium",
              connection.permission_mode === "balanced"
                ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            )}
          >
            {connection.permission_mode === "balanced" ? (
              <ShieldAlert className="size-3" />
            ) : (
              <Shield className="size-3" />
            )}
            {t(`modes.${connection.permission_mode}`)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-0.5 text-muted-foreground tabular-nums">
            <ServerIcon className="size-3" />
            {t("serverCount", { count: connection.server_ids.length })}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-0.5 text-muted-foreground tabular-nums">
            <Users className="size-3" />
            {t("bindingCount", { count: activeBindings.length })}
          </span>
          {hasBusySession ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/12 px-2 py-0.5 font-medium text-sky-700 dark:text-sky-300">
              <Loader2 className="size-3 animate-spin" />
              {t("sessionStatus.running")}
            </span>
          ) : null}
        </div>

        {/* 连接异常直接展示，不再藏于设置弹窗 */}
        {connection.last_error ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <p className="line-clamp-2 break-words leading-5" title={connection.last_error}>
              {connection.last_error}
            </p>
          </div>
        ) : null}

        {/* 待批准申请内联快速审批 */}
        {firstPending ? (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-amber-800 dark:text-amber-300">
                {t("requests")} · {pendingRequests.length}
              </span>
              <time className="text-[11px] tabular-nums text-muted-foreground">
                {shortTime(firstPending.updated_at)}
              </time>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-medium text-amber-700 dark:text-amber-300">
                {firstPending.is_group ? <Users className="size-3.5" /> : initial(firstPending.display_name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{firstPending.display_name}</p>
                {firstPending.message ? (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{firstPending.message}</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-7 flex-1 text-xs"
                disabled={requestBusyId !== null}
                onClick={() => void handleRequestAction(firstPending, true)}
              >
                <Check className="mr-1 size-3.5" />
                {t("approve")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs"
                disabled={requestBusyId !== null}
                onClick={() => void handleRequestAction(firstPending, false)}
              >
                <X className="mr-1 size-3.5" />
                {t("ignore")}
              </Button>
            </div>
            {pendingRequests.length > 1 ? (
              <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90">
                {t("moreRequests", { count: pendingRequests.length - 1 })}
              </p>
            ) : null}
          </div>
        ) : latestSession ? (
          <button
            type="button"
            onClick={() => onOpenChat(latestSession.id)}
            className="flex w-full items-center gap-2.5 rounded-xl border bg-muted/25 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-xs font-medium text-sky-700 dark:text-sky-300">
              {initial(latestSession.display_name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-foreground">
                  {latestSession.display_name || t("unnamed")}
                </span>
                <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {shortTime(latestSession.updated_at)}
                </time>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {busyStatuses.has(latestSession.status)
                  ? t(`sessionStatus.${latestSession.status}`)
                  : latestSession.preview || t("latestSession")}
              </p>
            </div>
          </button>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed bg-muted/15 px-3 py-2.5 text-xs text-muted-foreground">
            <span className="truncate">{t("noSessionsYet")}</span>
            <a
              href={botLink(connection)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
            >
              <span>{t("openBotShort")}</span>
              <ExternalLink className="size-3" />
            </a>
          </div>
        )}
      </div>

      {/* 底部操作条：进入沉浸对话为主操作，管理/编辑/打开机器人为辅助 */}
      <div className="flex items-center justify-between gap-2 border-t pt-3.5">
        <Button type="button" size="sm" className="gap-1.5" onClick={() => onOpenChat(latestSession?.id)}>
          <MessageSquare className="size-3.5" />
          <span>{t("openChat")}</span>
          {sessionList.length > 0 ? (
            <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.25 text-[10px] font-semibold tabular-nums">
              {sessionList.length}
            </span>
          ) : null}
          <ArrowRight className="size-3.5" />
        </Button>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 text-muted-foreground hover:text-foreground"
            title={t("openBotShort")}
            aria-label={t("openBotShort")}
            asChild
          >
            <a href={botLink(connection)} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 text-muted-foreground hover:text-foreground"
            title={t("edit")}
            aria-label={t("edit")}
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2.5 text-xs"
            onClick={onManage}
          >
            <Settings2 className="size-3.5" />
            <span>{t("bindingsManage")}</span>
          </Button>
        </div>
      </div>
    </article>
  )
}

function PlatformAvatar({ provider, size = "md" }: { provider: Provider; size?: "sm" | "md" | "lg" }) {
  const isTelegram = provider === "telegram"
  const box = size === "lg" ? "size-10 rounded-xl" : size === "sm" ? "size-7 rounded-lg" : "size-9 rounded-xl"
  const icon = size === "lg" ? "size-5" : size === "sm" ? "size-3.5" : "size-4"
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        box,
        isTelegram
          ? "bg-sky-500/12 text-sky-600 dark:text-sky-400"
          : "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400",
      )}
    >
      {isTelegram ? <Send className={icon} /> : <BotMessageSquare className={icon} />}
    </span>
  )
}

function ConnectionStatusPill({ status }: { status: ChatConnection["status"] }) {
  const { t } = useTranslation("chatConnections")
  const styles: Record<ChatConnection["status"], string> = {
    connected: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    connecting: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    error: "border-destructive/25 bg-destructive/10 text-destructive",
    disabled: "border-border bg-muted text-muted-foreground",
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", styles[status])}>
      {status === "connecting" ? (
        <Loader2 className="size-2.5 animate-spin" />
      ) : (
        <StatusDot status={status} />
      )}
      <span>{t(`connectionStatus.${status}`)}</span>
    </span>
  )
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

function FormTab({ value, busy, children }: { value: string; busy: boolean; children: ReactNode }) {
  return <TabsContent value={value} className="mt-4 min-h-0 overflow-y-auto pl-0.5 pr-1"><fieldset disabled={busy} className="min-w-0 space-y-4 px-1">{children}</fieldset></TabsContent>
}

function ConnectionForm({
  connection,
  initialProvider,
  onSaved,
}: {
  connection?: ChatConnection
  initialProvider?: Provider
  onSaved: (value: ChatConnection) => Promise<void>
}) {
  const { t } = useTranslation("chatConnections")
  const [provider, setProvider] = useState<Provider>(connection?.provider ?? initialProvider ?? "telegram")
  const [name, setName] = useState(connection?.name ?? "")
  const [token, setToken] = useState("")
  const [appId, setAppId] = useState(connection?.app_id ?? "")
  const [mode, setMode] = useState<ChatConnectionInput["permission_mode"]>(connection?.permission_mode ?? "readonly")
  const [serverIds, setServerIds] = useState<string[]>(connection?.server_ids ?? [])
  const [systemPrompt, setSystemPrompt] = useState(connection?.system_prompt ?? "")
  const [enabled, setEnabled] = useState(connection?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const sources = useQuery({ queryKey: queryKeys.chatConnections.servers, queryFn: () => loadAllServers((params) => serversApi.list(params)) })
  const selectedServerIds = serverIds.filter((id) => sources.data?.some((server) => server.id === id))
  const selectedServers = sources.data?.filter((server) => selectedServerIds.includes(server.id)) ?? []

  const botReady =
    Boolean(name.trim()) &&
    new TextEncoder().encode(name.trim()).length <= 100 &&
    (Boolean(connection) || (Boolean(token.trim()) && (provider === "telegram" || Boolean(appId.trim()))))
  const accessReady = selectedServerIds.length > 0 && selectedServerIds.length <= 100 && sources.isSuccess
  const agentReady = systemPromptValid(systemPrompt, selectedServerIds)
  const valid = botReady && accessReady && agentReady

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !valid) return
    setBusy(true)
    setError("")
    try {
      // Each platform accepts only its own credential fields.
      const credentials = provider === "feishu" ? { app_id: appId.trim(), app_secret: token.trim() } : { token: token.trim() }
      const value = await chatConnectionsApi.save(connection?.id, {
        provider,
        name: name.trim(),
        ...credentials,
        permission_mode: mode,
        server_ids: selectedServerIds,
        system_prompt: systemPrompt,
        enabled,
      })
      setToken("")
      await onSaved(value)
    } catch (err) {
      setError(getErrorMessage(err, t("saveFailed")))
    } finally {
      setBusy(false)
    }
  }

  const stepTabs = [
    { key: "bot" as const, step: 1, done: botReady, badge: null as number | null },
    { key: "access" as const, step: 2, done: accessReady, badge: selectedServerIds.length > 0 ? selectedServerIds.length : null },
    { key: "agent" as const, step: 3, done: agentReady && accessReady, badge: null as number | null },
  ]

  const footerHint = error
    ? { tone: "error" as const, text: error }
    : !botReady
      ? { tone: "warn" as const, text: t("formHintBotRequired") }
      : !accessReady
        ? { tone: "warn" as const, text: t("formHintServerRequired") }
        : connection
          ? { tone: "info" as const, text: t("editStopsWork") }
          : { tone: "ok" as const, text: t("formHintReady") }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
      <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
        <div className="flex items-start gap-3">
          <PlatformAvatar provider={provider} size="md" />
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="text-base">{connection ? t("edit") : t("create")}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">{t(`platformTagline.${provider}`)}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <Tabs defaultValue="bot" className="min-h-0 flex-1 overflow-hidden px-6 pt-4">
        <TabsList className="grid h-auto w-full shrink-0 grid-cols-3 p-1" aria-label={connection ? t("edit") : t("create")}>
          {stepTabs.map(({ key, step, done, badge }) => (
            <TabsTrigger key={key} value={key} className="gap-1.5 py-1.5 text-xs">
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  done
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted-foreground/15 text-muted-foreground",
                )}
              >
                {done ? <Check className="size-2.5 stroke-[3]" /> : step}
              </span>
              <span>{t(`sections.${key}`)}</span>
              {badge !== null ? (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.25 text-[10px] font-medium tabular-nums text-primary">
                  {badge}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <FormTab value="bot" busy={busy}>
          {!connection && (
            <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label={t("platform")}>
              {(["telegram", "feishu"] as const).map((item) => {
                const selected = provider === item
                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setProvider(item)
                      setToken("")
                    }}
                    className={cn(
                      "relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all",
                      selected
                        ? "border-primary bg-primary/[0.04] ring-1 ring-primary/15"
                        : "bg-card hover:border-foreground/20 hover:bg-muted/30",
                    )}
                  >
                    <PlatformAvatar provider={item} size="md" />
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-sm font-medium text-foreground">{t(`providers.${item}`)}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t(`platformTagline.${item}`)}</p>
                    </div>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute right-3 top-3 flex size-4 items-center justify-center rounded-full border transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30",
                      )}
                    >
                      {selected ? <Check className="size-2.5 stroke-[3]" /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <p className="text-xs leading-5 text-muted-foreground">{t(`setupHelp.${provider}`)}</p>

          {provider === "feishu" && !connection && <FeishuSteps />}

          <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="chat-name" className="text-xs">{t("name")}</Label>
              <Input
                id="chat-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={100}
                className="h-9 bg-background"
                placeholder={t("namePlaceholder")}
              />
            </div>

            {provider === "telegram" ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="chat-token" className="text-xs">Bot Token</Label>
                  <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {t("openBotFather")}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                <Input
                  id="chat-token"
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required={!connection}
                  className="h-9 bg-background font-mono text-xs"
                  placeholder={connection ? t("keepToken") : "123456:…"}
                />
                <p className="text-[11px] leading-5 text-muted-foreground">{t("tokenHelp")}</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {/* The application identifies the connection; switching apps needs a new connection. */}
                <div className="space-y-1.5">
                  <Label htmlFor="chat-app-id" className="text-xs">App ID</Label>
                  <Input
                    id="chat-app-id"
                    value={appId}
                    onChange={(event) => setAppId(event.target.value)}
                    required
                    disabled={!!connection}
                    className="h-9 bg-background font-mono text-xs"
                    placeholder="cli_…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="chat-app-secret" className="text-xs">App Secret</Label>
                  <Input
                    id="chat-app-secret"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    required={!connection}
                    className="h-9 bg-background font-mono text-xs"
                    placeholder={connection ? t("keepSecret") : ""}
                  />
                </div>
              </div>
            )}
          </div>
        </FormTab>

        <FormTab value="access" busy={busy}>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("permissionMode")}</Label>
            <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label={t("permissionMode")}>
              {(["readonly", "balanced"] as const).map((item) => {
                const selected = mode === item
                const Icon = item === "balanced" ? ShieldAlert : Shield
                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMode(item)}
                    className={cn(
                      "relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all",
                      selected
                        ? "border-primary bg-primary/[0.04] ring-1 ring-primary/15"
                        : "bg-card hover:border-foreground/20 hover:bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        item === "balanced"
                          ? "bg-amber-500/12 text-amber-600 dark:text-amber-400"
                          : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-sm font-medium text-foreground">{t(`modes.${item}`)}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t(`modeHelp.${item}`)}</p>
                    </div>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute right-3 top-3 flex size-4 items-center justify-center rounded-full border transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30",
                      )}
                    >
                      {selected ? <Check className="size-2.5 stroke-[3]" /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("servers")}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("serversHelp")}</p>
            </div>
            {sources.isError && (
              <div role="alert" className="text-sm text-destructive">
                {t("loadFailed")}
                <Button type="button" variant="link" size="sm" onClick={() => void sources.refetch()}>{t("retry")}</Button>
              </div>
            )}
            {sources.isSuccess && !sources.data.length ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">{t("noServers")}</p>
            ) : (
              <ServerScopePicker
                servers={sources.data ?? []}
                value={selectedServerIds}
                loading={sources.isPending}
                disabled={busy || !sources.isSuccess}
                onChange={setServerIds}
              />
            )}
          </div>
        </FormTab>

        <FormTab value="agent" busy={busy}>
          <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
            <Label htmlFor="chat-prompt" className="text-xs font-medium">{t("systemPrompt")}</Label>
            <SystemPromptEditor id="chat-prompt" value={systemPrompt} servers={selectedServers} disabled={busy} onChange={setSystemPrompt} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm">
            <div>
              <span className="block font-medium text-foreground">{t("enabled")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(`platformTagline.${provider}`)}</span>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
        </FormTab>
      </Tabs>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/20 px-6 py-3.5">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              footerHint.tone === "error"
                ? "bg-destructive"
                : footerHint.tone === "warn"
                  ? "bg-amber-500"
                  : footerHint.tone === "ok"
                    ? "bg-emerald-500"
                    : "bg-sky-500",
            )}
          />
          <p
            role={footerHint.tone === "error" ? "alert" : undefined}
            className={cn(
              "min-w-0 truncate",
              footerHint.tone === "error"
                ? "text-destructive"
                : footerHint.tone === "warn"
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-muted-foreground",
            )}
          >
            {footerHint.text}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm" disabled={busy}>
              {t("common:cancel")}
            </Button>
          </DialogClose>
          <Button type="submit" size="sm" disabled={busy || !valid}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {busy ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </form>
  )
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
    <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex items-center gap-2 text-sm font-medium"><Switch checked={connection.enabled} disabled={busy} onCheckedChange={enabled => void run(() => chatConnectionsApi.setEnabled(id, enabled))} />{t("enabled")}</label>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(connection)}><Settings2 className="size-3.5" />{t("edit")}</Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => void run(async () => { if (await confirm({ description: t("deleteConfirm"), variant: "destructive" })) { await chatConnectionsApi.remove(id); onDeleted() } })}><Trash2 className="size-3.5" />{t("delete")}</Button>
      </div>
      {connection.last_error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]">{connection.last_error}</p>}
    </section>
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("bindings")}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{bindings.length}</span>
      </div>
      {bindings.length === 0 && <p className="text-xs text-muted-foreground">{t("noBindings")}</p>}
      <div className="divide-y">
        {bindings.map(binding => <div key={binding.id} className="flex flex-col gap-2.5 py-3 first:pt-1 last:pb-0 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0 [overflow-wrap:anywhere]"><p className="text-sm font-medium">{binding.display_name || binding.user_id}</p><p className="text-xs text-muted-foreground">ID: {binding.external_user_id || binding.user_id} · {binding.revoked_at ? t("revoked") : t("bound")}</p></div>
          <div className="flex flex-wrap gap-1.5">
            {binding.current_session_id && <Button size="sm" variant="ghost" className="h-7 text-xs" asChild><Link to={`/dashboard/ai-assistant?session=${encodeURIComponent(binding.current_session_id)}`}>{t("openSession")}<ExternalLink className="size-3" /></Link></Button>}
            {!binding.revoked_at && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void run(async () => { if (await confirm({ description: t("revokeConfirm"), variant: "destructive" })) await chatConnectionsApi.revoke(id, binding.id) })}>{t("revoke")}</Button>}
          </div>
        </div>)}
      </div>
    </section>
    {confirmDialog}
  </div>
}
