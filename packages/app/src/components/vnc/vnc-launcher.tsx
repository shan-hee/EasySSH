import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ServerConnectionConfigsApi } from "@/components/servers/server-connection-configs"
import type { Server } from "@/lib/server-types"
import type { components } from "@/generated/openapi"
import { apiFetch } from "@/lib/api-client"

type Config = components["schemas"]["VNCConfig"]

export function VNCLauncher({ open, onOpenChange, serverApi, onConnect }: { open: boolean; onOpenChange: (open: boolean) => void; serverApi: ServerConnectionConfigsApi; onConnect: (server: Server) => boolean }) {
  const { t } = useTranslation("terminal")
  const [search, setSearch] = useState("")
  const [servers, setServers] = useState<Server[]>([])
  const [selected, setSelected] = useState<Server | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [saved, setSaved] = useState<Config | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!open) return
    let disposed = false
    const timer = setTimeout(() => { void serverApi.list({ limit: 100, search }).then(value => {
      if (!disposed) setServers(Array.isArray(value) ? value : value.data)
    }).catch(() => { if (!disposed) setError(t("vncLoadFailed")) }) }, 180)
    return () => { disposed = true; clearTimeout(timer) }
  }, [open, search, serverApi, t])
  useEffect(() => {
    setConfig(null); setSaved(null); setError("")
    if (!open || !selected) return
    const abort = new AbortController()
    void apiFetch<Config>(`/vnc/${selected.id}/config`, { signal: abort.signal }).then(value => { if (!abort.signal.aborted) { setConfig(value); setSaved(value) } }).catch(() => { if (!abort.signal.aborted) setError(t("vncLoadFailed")) })
    return () => abort.abort()
  }, [open, selected, t])
  const dirty = JSON.stringify(config) !== JSON.stringify(saved)
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader>
    <DialogTitle>{t("vncTitle")}</DialogTitle><DialogDescription>{t("vncDescription")}</DialogDescription>
  </DialogHeader>
    <Input disabled={busy} aria-label={t("vncSearch")} placeholder={t("vncSearch")} value={search} onChange={e => setSearch(e.target.value)} />
    <select disabled={busy} className="h-10 rounded border bg-background px-2" aria-label={t("vncSelectServer")} value={selected?.id ?? ""} onChange={e => setSelected(servers.find(s => s.id === e.target.value) ?? null)}>
      <option value="">{t("vncSelectServer")}</option>{servers.map(s => <option key={s.id} value={s.id}>{s.name} · {s.host}</option>)}
    </select>
    {config && <fieldset disabled={busy} className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />{t("vncEnabled")}</label>
      <label className="block text-sm">{t("vncPort")}<Input type="number" min={1} max={65535} value={config.port} onChange={e => setConfig({ ...config, port: Number(e.target.value) })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.tls} onChange={e => setConfig({ ...config, tls: e.target.checked })} />{t("vncTLS")}</label>
      <p className="text-xs text-muted-foreground">{t("vncConfigRevision")}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={!dirty || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535} onClick={async () => {
          setBusy(true); setError("")
          try { await apiFetch(`/vnc/${selected!.id}/config`, { method: "PUT", body: config }); setSaved(config) }
          catch { setError(t("vncSaveFailed")) } finally { setBusy(false) }
        }}>{t("vncSave")}</Button>
        <Button disabled={dirty || !config.enabled} onClick={() => { if (selected && onConnect(selected)) onOpenChange(false) }}>{t("vncConnect")}</Button>
      </div>
    </fieldset>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </DialogContent></Dialog>
}
