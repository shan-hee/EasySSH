import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArchiveRestore, Download, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SettingsSection } from "@/components/settings/settings-section"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { authenticatedFetch } from "@/lib/api-client"
import { createAuthTicket } from "@/lib/auth-ticket"
import { getApiUrl } from "@/lib/config"
import type { components } from "@/types/openapi"

export type InstanceBackupRecord = components["schemas"]["InstanceBackupRecord"]
type InstanceBackupList = components["schemas"]["InstanceBackupList"]
export interface InstanceBackupAdapter {
  list(): Promise<InstanceBackupList>
  create(password: string): Promise<InstanceBackupRecord>
  upload(file?: File): Promise<InstanceBackupRecord | null>
  download(record: InstanceBackupRecord): Promise<void>
  remove(id: string): Promise<void>
  inspect(id: string, password: string): Promise<InstanceBackupRecord>
  restore(id: string, password: string): Promise<InstanceBackupRecord>
  nativeFilePicker?: boolean
}

const activeStatuses = new Set(["creating", "uploading", "checking", "restoring"])

export function InstanceBackupPanel({ adapter }: { adapter: InstanceBackupAdapter }) {
  const { t } = useTranslation("settingsManagementBackup")
  const { confirm, confirmDialog } = useConfirmDialog()
  const [data, setData] = useState<InstanceBackupList>({ items: [], restore_available: false, max_upload_bytes: 0 })
  const [loadError, setLoadError] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)
  const [dialog, setDialog] = useState<{ action: "create" | "inspect" | "restore"; record?: InstanceBackupRecord } | null>(null)
  const [password, setPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const previous = useRef<Map<string, string>>(new Map())
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const next = await adapter.list()
      if (!mounted.current) return
      for (const record of next.items) {
        if (activeStatuses.has(previous.current.get(record.id) || "") && !activeStatuses.has(record.status)) {
          if (record.error) toast.error(record.error)
          else toast.success(t("instanceOperationComplete"))
        }
      }
      previous.current = new Map(next.items.map(record => [record.id, record.status]))
      setData(next)
      setLoaded(true)
      setLoadError("")
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : t("instanceLoadFailed"))
    }
  }, [adapter, t])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refresh()
      if (!cancelled) timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer) }
  }, [refresh])

  const running = data.items.some(record => activeStatuses.has(record.status))
  const disabled = busy || running || !loaded || Boolean(loadError)
  const filtered = data.items.filter(record => `${record.name} ${record.app_version || ""}`.toLowerCase().includes(query.toLowerCase()))
  const maxPage = Math.max(0, Math.ceil(filtered.length / 10) - 1)
  const currentPage = Math.min(page, maxPage)
  const rows = filtered.slice(currentPage * 10, currentPage * 10 + 10)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action(); await refresh() }
    catch (error) { toast.error(error instanceof Error ? error.message : t("instanceOperationFailed")) }
    finally { setBusy(false) }
  }

  const open = (action: "create" | "inspect" | "restore", record?: InstanceBackupRecord) => {
    setPassword(""); setRepeatPassword(""); setDialog({ action, record })
  }

  const submit = async () => {
    if (!dialog || !password.trim()) return
    if (dialog.action === "create" && password !== repeatPassword) { toast.error(t("instancePasswordMismatch")); return }
    await run(async () => {
      const record = dialog.action === "create" ? await adapter.create(password)
        : dialog.action === "inspect" ? await adapter.inspect(dialog.record!.id, password)
        : await adapter.restore(dialog.record!.id, password)
      previous.current.set(record.id, record.status)
      setDialog(null); setPassword(""); setRepeatPassword("")
      toast.success(t("instanceTaskStarted"))
    })
  }

  const upload = (file?: File) => run(async () => {
    if (file && file.size > data.max_upload_bytes) throw new Error(t("instanceUploadTooLarge"))
    const record = await adapter.upload(file)
    if (record) toast.success(t("instanceUploadDone"))
  })

  return (
    <SettingsSection title={t("nativeTitle")} description={t("instanceDescription")} icon={<ArchiveRestore className="size-5" />}>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => open("create")} disabled={disabled}><Plus className="mr-2 size-4" />{t("instanceCreate")}</Button>
        <Button variant="outline" disabled={disabled} onClick={() => adapter.nativeFilePicker ? void upload() : input.current?.click()}><Upload className="mr-2 size-4" />{t("instanceUpload")}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw className="mr-2 size-4" />{t("instanceRefresh")}</Button>
        {(busy || running) && <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("instanceWorking")}</span>}
        <input ref={input} type="file" accept=".age,.easyssh.age" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file) }} />
      </div>
      <p className="text-sm text-muted-foreground">{t("instancePasswordNote")}</p>
      <p className="text-sm text-muted-foreground">{t("instanceRestoreNote")}</p>
      {!data.restore_available && loaded && <p className="text-sm text-muted-foreground">{t("instanceRestoreUnavailable")}</p>}
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <h3 className="text-sm font-medium">{t("instanceHistory", { count: data.items.length })}</h3>
        <Input className="max-w-xs" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder={t("instanceSearch")} aria-label={t("instanceSearch")} />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50"><tr>{["instanceFile", "instanceCreatedAt", "instanceSize", "instanceStatus", "instanceActions"].map(key => <th key={key} className="p-3 font-medium">{t(key as "instanceFile")}</th>)}</tr></thead>
          <tbody>
            {rows.map(record => (
              <tr key={record.id} className="border-t align-top">
                <td className="min-w-64 p-3"><div className="break-all font-medium">{record.name}</div><div className="mt-1 text-xs text-muted-foreground">{record.source === "uploaded" ? t("instanceSourceUploaded") : t("instanceSourceCreated")}{record.app_version ? ` · ${record.app_version} · ${record.driver}` : ""}</div>{record.restored_to && <div className="mt-2 max-w-lg break-all text-xs">{t("instanceRestoredTo", { path: record.restored_to })}</div>}</td>
                <td className="whitespace-nowrap p-3">{new Date(record.created_at).toLocaleString()}</td>
                <td className="whitespace-nowrap p-3">{formatSize(record.size)}</td>
                <td className="min-w-40 p-3"><span>{t(`instanceState_${record.status}` as "instanceState_ready")}</span>{record.verified_at && <div className="mt-1 text-xs text-muted-foreground">{t("instanceVerifiedAt", { date: new Date(record.verified_at).toLocaleString() })}</div>}{record.error && <p className="mt-1 max-w-xs break-words text-xs text-destructive">{record.error}</p>}</td>
                <td className="p-3"><div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" disabled={busy || record.size === 0 || activeStatuses.has(record.status)} onClick={() => void run(() => adapter.download(record))}><Download className="mr-1 size-4" />{t("instanceDownload")}</Button>
                  <Button size="sm" variant="ghost" disabled={disabled || record.size === 0} onClick={() => open("inspect", record)}><ShieldCheck className="mr-1 size-4" />{t("instanceInspect")}</Button>
                  <Button size="sm" variant="ghost" disabled={disabled || record.size === 0 || !data.restore_available} onClick={() => open("restore", record)}><ArchiveRestore className="mr-1 size-4" />{t("instanceRestore")}</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={disabled} onClick={() => void (async () => { if (await confirm({ title: t("instanceDelete"), description: t("instanceDeleteConfirm", { name: record.name }), variant: "destructive" })) await run(() => adapter.remove(record.id)) })()}><Trash2 className="mr-1 size-4" />{t("instanceDelete")}</Button>
                </div></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">{!loaded ? t("instanceLoading") : query ? t("instanceNoMatch") : t("instanceEmpty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {filtered.length > 10 && <div className="flex items-center justify-end gap-3 text-sm"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("instancePrevious")}</Button><span>{currentPage + 1} / {maxPage + 1}</span><Button size="sm" variant="outline" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}>{t("instanceNext")}</Button></div>}
      <Dialog open={Boolean(dialog)} onOpenChange={value => { if (!value && !busy) { setDialog(null); setPassword(""); setRepeatPassword("") } }}>
        <DialogContent><DialogHeader><DialogTitle>{dialog?.action === "create" ? t("instanceCreate") : dialog?.action === "restore" ? t("instanceRestore") : t("instanceInspect")}</DialogTitle><DialogDescription>{dialog?.action === "restore" ? t("instanceRestoreConfirm") : t("instancePasswordNote")}</DialogDescription></DialogHeader>
          {dialog?.record && <p className="break-all text-sm">{dialog.record.name}</p>}
          <div className="space-y-2"><Label htmlFor="instance-password">{t("instancePassword")}</Label><Input id="instance-password" autoComplete={dialog?.action === "create" ? "new-password" : "off"} type="password" value={password} maxLength={256} onChange={event => setPassword(event.target.value)} disabled={busy} /></div>
          {dialog?.action === "create" && <div className="space-y-2"><Label htmlFor="instance-password-repeat">{t("instancePasswordRepeat")}</Label><Input id="instance-password-repeat" autoComplete="new-password" type="password" value={repeatPassword} maxLength={256} onChange={event => setRepeatPassword(event.target.value)} disabled={busy} /></div>}
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setDialog(null); setPassword(""); setRepeatPassword("") }}>{t("instanceCancel")}</Button><Button disabled={busy || !password.trim() || (dialog?.action === "create" && password !== repeatPassword)} onClick={() => void submit()}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />}{t("instanceContinue")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </SettingsSection>
  )
}

function formatSize(size: number) {
  if (!size) return "—"
  const units = ["B", "KiB", "MiB", "GiB"]
  const index = Math.min(3, Math.floor(Math.log(size) / Math.log(1024)))
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

async function instanceRequest(path: string, init?: RequestInit) {
  const response = await authenticatedFetch(`${getApiUrl()}/backup/instances${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(typeof body.error === "string" ? body.error : `Backup request failed (${response.status})`)
  }
  return response
}

export const webInstanceBackupAdapter: InstanceBackupAdapter = {
  list: async () => (await instanceRequest("")).json(),
  create: async password => (await instanceRequest("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })).json(),
  upload: async file => { if (!file) return null; const body = new FormData(); body.append("file", file); return (await instanceRequest("/upload", { method: "POST", body })).json() },
  download: async record => {
    const { ticket } = await createAuthTicket({ type: "instance_backup_download", backup_id: record.id })
    const link = document.createElement("a")
    link.href = `${getApiUrl()}/backup/instances/${record.id}/download?ticket=${encodeURIComponent(ticket)}`
    link.download = record.name
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    document.body.appendChild(link)
    link.click()
    link.remove()
  },
  remove: async id => { await instanceRequest(`/${id}`, { method: "DELETE" }) },
  inspect: async (id, password) => (await instanceRequest(`/${id}/inspect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })).json(),
  restore: async (id, password) => (await instanceRequest(`/${id}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, confirm: true }) })).json(),
}
