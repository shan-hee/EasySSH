import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ServerConnectionConfigsApi } from "@/components/servers/server-connection-configs"
import type { Server } from "@/lib/server-types"
import type { components } from "@/generated/openapi"
import { apiFetch } from "@/lib/api-client"

type Config = components["schemas"]["RDPConfig"]

export function RDPLauncher({ open, onOpenChange, serverApi, onConnect }: { open: boolean; onOpenChange: (open: boolean) => void; serverApi: ServerConnectionConfigsApi; onConnect: (server: Server) => boolean }) {
  const { t } = useTranslation("terminal")
  const [configured, setConfigured] = useState<boolean | null>(null)
  useEffect(() => { if (!open) return; let active = true; void apiFetch<{ configured: boolean }>("/rdp/status").then(value => { if (active) setConfigured(value.configured) }).catch(() => { if (active) { setConfigured(null); setError(t("rdpLoadFailed")) } }); return () => { active = false } }, [open, t])
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
    }).catch(() => { if (!disposed) setError(t("rdpLoadFailed")) }) }, 180)
    return () => { disposed = true; clearTimeout(timer) }
  }, [open, search, serverApi, t])
  useEffect(() => {
    setConfig(null); setSaved(null); setError("")
    if (!open || !selected) return
    const abort = new AbortController()
    void apiFetch<Config>(`/rdp/${selected.id}/config`, { signal: abort.signal }).then(value => { if (!abort.signal.aborted) { setConfig(value); setSaved(value) } }).catch(() => { if (!abort.signal.aborted) setError(t("rdpLoadFailed")) })
    return () => abort.abort()
  }, [open, selected, t])
  const dirty = JSON.stringify(config) !== JSON.stringify(saved)
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader>
    <DialogTitle>{t("rdpTitle")}</DialogTitle><DialogDescription>{t("rdpDescription")}</DialogDescription>
  </DialogHeader>
    {configured === false && <p role="status" className="text-sm text-muted-foreground">{t("rdpGatewayMissing")}</p>}
    <Input disabled={busy} aria-label={t("rdpSearch")} placeholder={t("rdpSearch")} value={search} onChange={e => setSearch(e.target.value)} />
    <select disabled={busy} className="h-10 rounded border bg-background px-2" aria-label={t("rdpSelectServer")} value={selected?.id ?? ""} onChange={e => setSelected(servers.find(s => s.id === e.target.value) ?? null)}>
      <option value="">{t("rdpSelectServer")}</option>{servers.map(s => <option key={s.id} value={s.id}>{s.name} · {s.host}</option>)}
    </select>
    {config && <fieldset disabled={busy} className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />{t("rdpEnabled")}</label>
      <label className="block text-sm">{t("rdpPort")}<Input type="number" min={1} max={65535} value={config.port} onChange={e => setConfig({ ...config, port: Number(e.target.value) })} /></label>
      <label className="block text-sm">{t("rdpSecurity")}<select className="ml-2 rounded border bg-background p-1" value={config.security} onChange={e => setConfig({ ...config, security: e.target.value as Config["security"] })}><option value="nla">NLA</option><option value="tls">TLS</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.ignore_certificate} onChange={e => setConfig({ ...config, ignore_certificate: e.target.checked })} />{t("rdpIgnoreCertificate")}</label>
      <p className="text-xs text-muted-foreground">{t("rdpConfigRevision")}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={!dirty || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535} onClick={async () => {
          setBusy(true); setError("")
          try { await apiFetch(`/rdp/${selected!.id}/config`, { method: "PUT", body: config }); setSaved(config) }
          catch { setError(t("rdpSaveFailed")) } finally { setBusy(false) }
        }}>{t("rdpSave")}</Button>
        <Button disabled={configured !== true || dirty || !config.enabled} onClick={() => { if (selected && onConnect(selected)) onOpenChange(false) }}>{t("rdpConnect")}</Button>
      </div>
    </fieldset>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </DialogContent></Dialog>
}
