import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { ExternalLink, MessageCircle, Plus, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { CopyButton } from "@/components/automation/mcp-connection"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { chatConnectionsApi, type ChatBindCode, type ChatConnection, type ChatConnectionInput } from "@/lib/api/chat-connections"
import { serversApi } from "@/lib/api/servers"
import { getErrorMessage } from "@/lib/error-utils"
import { getServerDisplayName, loadAllServers } from "@/lib/server-utils"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { useRuntime } from "@/shell/runtime"

export default function ChatConnectionsPage() {
  const { t } = useTranslation("chatConnections")
  const { runtime } = useRuntime()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [editor, setEditor] = useState<ChatConnection | "new" | null>(null)
  const web = runtime?.profile === "web"
  const connections = useQuery({ queryKey: queryKeys.chatConnections.list, queryFn: chatConnectionsApi.list, enabled: web, refetchInterval: 5000 })
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.chatConnections.root }) }
  const selectedConnection = connections.data?.find(connection => connection.id === selected)
  if (!web) return <p className="p-4 text-sm text-muted-foreground">{t("webOnly")}</p>
  return <>
    <PageHeader title={t("title")} />
    <DashboardPageContent className="min-h-0 gap-6 overflow-y-auto">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
        <Button size="sm" onClick={() => setEditor("new")}><Plus className="size-4" />{t("create")}</Button>
      </section>
      {connections.isPending && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
      {connections.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">{t("loadFailed")}<Button variant="outline" size="sm" onClick={() => void connections.refetch()}>{t("retry")}</Button></div>}
      {connections.data?.length === 0 && <section className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center"><MessageCircle className="size-7 text-muted-foreground" /><p className="text-sm font-medium">{t("empty")}</p><p className="max-w-md text-sm text-muted-foreground">{t("emptyHelp")}</p><Button variant="outline" size="sm" onClick={() => setEditor("new")}>{t("create")}</Button></section>}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {connections.data?.map(connection => <button type="button" key={connection.id} onClick={() => setSelected(connection.id)} aria-haspopup="dialog"
          className={cn("w-full space-y-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring", selected === connection.id && "border-primary")}>
          <div className="flex items-center gap-3"><MessageCircle className="size-5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{connection.name}</span><span className={cn("size-2 rounded-full", connection.status === "connected" ? "bg-emerald-500" : connection.status === "error" ? "bg-destructive" : "bg-muted-foreground/40")} /></div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>Telegram · @{connection.bot_username}</span><span>{t(`connectionStatus.${connection.status}`)}</span></div>
          <p className="text-xs text-muted-foreground">{t(`modes.${connection.permission_mode}`)} · {t("serverCount", { count: connection.server_ids.length })}</p>
        </button>)}
      </div>
    </DashboardPageContent>
    <Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null) }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{selectedConnection?.name ?? t("title")}</DialogTitle>
          <DialogDescription>{selectedConnection ? `Telegram · @${selectedConnection.bot_username} · ${t(`connectionStatus.${selectedConnection.status}`)}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {selected && <ConnectionDetail key={selected} id={selected} onEdit={setEditor} onDeleted={() => setSelected(null)} />}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={editor !== null} onOpenChange={open => { if (!open) setEditor(null) }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {editor !== null && <ConnectionForm key={editor === "new" ? "new" : editor.id} connection={editor === "new" ? undefined : editor} onSaved={async value => { setEditor(null); setSelected(value.id); await refresh() }} />}
      </DialogContent>
    </Dialog>
  </>
}

function ConnectionForm({ connection, onSaved }: { connection?: ChatConnection; onSaved: (value: ChatConnection) => Promise<void> }) {
  const { t } = useTranslation("chatConnections")
  const [name, setName] = useState(connection?.name ?? "")
  const [token, setToken] = useState("")
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
      const value = await chatConnectionsApi.save(connection?.id, { name: name.trim(), token: token.trim(), permission_mode: mode, server_ids: selectedServerIds, enabled })
      setToken("")
      await onSaved(value)
    } catch (error) { setError(getErrorMessage(error, t("saveFailed"))) } finally { setBusy(false) }
  }
  const valid = !!name.trim() && new TextEncoder().encode(name.trim()).length <= 100 && (!!connection || !!token.trim()) && selectedServerIds.length > 0 && selectedServerIds.length <= 100 && sources.isSuccess
  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => void submit(event)}>
    <DialogHeader className="shrink-0 border-b p-6 pr-12"><DialogTitle>{connection ? t("edit") : t("create")}</DialogTitle><DialogDescription>{t("setupHelp")}</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
      <div className="space-y-2"><Label htmlFor="chat-name">{t("name")}</Label><Input id="chat-name" value={name} onChange={event => setName(event.target.value)} required maxLength={100} placeholder={t("namePlaceholder")} /></div>
      <div className="space-y-2"><Label htmlFor="chat-token">Bot Token</Label><Input id="chat-token" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} required={!connection} placeholder={connection ? t("keepToken") : "123456:…"} /><p className="text-xs text-muted-foreground">{t("tokenHelp")} <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline">@BotFather</a></p></div>
      <div className="space-y-2"><Label htmlFor="chat-mode">{t("permissionMode")}</Label><Select value={mode} onValueChange={value => setMode(value as ChatConnectionInput["permission_mode"])}><SelectTrigger id="chat-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="readonly">{t("modes.readonly")}</SelectItem><SelectItem value="balanced">{t("modes.balanced")}</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{t(`modeHelp.${mode}`)}</p></div>
      <div className="space-y-2"><Label>{t("servers")}</Label><p className="text-xs text-muted-foreground">{t("serversHelp")}</p>
        {sources.isPending && <p className="text-sm">{t("loading")}</p>}
        {sources.isError && <div role="alert" className="text-sm text-destructive">{t("loadFailed")}<Button type="button" variant="link" size="sm" onClick={() => void sources.refetch()}>{t("retry")}</Button></div>}
        {sources.isSuccess && !sources.data.length && <p className="text-sm text-muted-foreground">{t("noServers")}</p>}
        {!!sources.data?.length && <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">{sources.data.map(server => <label key={server.id} className="flex items-center gap-3 rounded px-2 py-2 text-sm hover:bg-muted"><Checkbox checked={serverIds.includes(server.id)} onCheckedChange={checked => setServerIds(ids => checked === true ? [...ids, server.id] : ids.filter(id => id !== server.id))} /><span className="min-w-0 truncate">{getServerDisplayName(server)}</span></label>)}</div>}
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
  if (detail.isPending) return <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
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
      {bindCode && connection.enabled && <div className="space-y-2 rounded-md bg-muted p-3"><p className="text-xs">{codeExpired ? t("codeExpired") : t("codeExpires", { time: new Date(bindCode.expires_at).toLocaleTimeString() })}</p>{!codeExpired && <><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs">/bind {bindCode.code}</code><CopyButton value={`/bind ${bindCode.code}`} label={t("copyCode")} /></div><a className="inline-flex items-center gap-1 text-sm underline" href={bindCode.url} target="_blank" rel="noreferrer">{t("openTelegram")}<ExternalLink className="size-3" /></a></>}</div>}
      {bindings.length === 0 && <p className="text-sm text-muted-foreground">{t("noBindings")}</p>}
      {bindings.map(binding => <div key={binding.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div><p className="text-sm">{binding.display_name || binding.user_id}</p><p className="text-xs text-muted-foreground">ID: {binding.user_id} · {binding.revoked_at ? t("revoked") : t("bound")}</p></div>
        <div className="flex gap-2">
          {binding.current_session_id && <Button size="sm" variant="ghost" asChild><Link to={`/dashboard/ai-assistant?session=${encodeURIComponent(binding.current_session_id)}`}>{t("openSession")}<ExternalLink className="size-3" /></Link></Button>}
          {!binding.revoked_at && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { if (await confirm({ description: t("revokeConfirm"), variant: "destructive" })) await chatConnectionsApi.revoke(id, binding.id) })}>{t("revoke")}</Button>}
        </div>
      </div>)}
    </section>
    {confirmDialog}
  </div>
}
