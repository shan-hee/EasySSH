import { useEffect, useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PrivateKeyInput } from "./private-key-input"
import type { SSHKey, SSHKeyApi } from "@/lib/api/ssh-keys"
import { getErrorMessage } from "@/lib/error-utils"

export function SSHKeySelector({ api, value, onChange, onPendingChange }: {
  api: SSHKeyApi
  value: number
  onChange: (id: number) => void
  onPendingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation("servers")
  const id = useId()
  const [keys, setKeys] = useState<SSHKey[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [importing, setImporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState("")
  const [material, setMaterial] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [reload, setReload] = useState(0)
  const selected = keys.find(key => key.id === value)

  useEffect(() => {
    onPendingChange(importing || busy)
    return () => onPendingChange(false)
  }, [importing, busy, onPendingChange])


  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    api.list().then(items => { if (active) setKeys(items ?? []) })
      .catch(err => { if (active) setError(getErrorMessage(err, t("keyLoadFailed"))) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, reload, t])

  const clearImport = () => {
    setImporting(false)
    setName("")
    setMaterial("")
    setPassphrase("")
  }

  const importKey = async () => {
    if (!name.trim() || !material.trim()) { setError(t("keyImportRequired")); return }
    setBusy(true)
    setError("")
    try {
      const key = await api.import({ name: name.trim(), private_key: material, passphrase })
      setKeys(items => [...items.filter(item => item.id !== key.id), key])
      onChange(key.id)
      clearImport()
    } catch (err) { setError(getErrorMessage(err, t("keyImportFailed"))) }
    finally { setBusy(false) }
  }

  const deleteKey = async () => {
    if (!selected) return
    setBusy(true)
    setError("")
    try {
      await api.delete(selected.id)
      setKeys(items => items.filter(item => item.id !== selected.id))
      onChange(0)
      setConfirmDelete(false)
    } catch (err) { setError(getErrorMessage(err, t("keyDeleteFailed"))); setConfirmDelete(false) }
    finally { setBusy(false) }
  }

  return <div className="space-y-3">
    <Label htmlFor={`${id}-select`}>{t("keySelectionLabel")}</Label>
    <Select value={String(value)} onValueChange={next => onChange(Number(next))} disabled={loading || busy}>
      <SelectTrigger id={`${id}-select`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="0">{t("keyTemporary")}</SelectItem>
        {value > 0 && !selected && <SelectItem value={String(value)}>{t("keyUnavailable", { id: value })}</SelectItem>}
        {keys.map(key => <SelectItem key={key.id} value={String(key.id)}>{key.name} · {key.algorithm.toUpperCase()}</SelectItem>)}
      </SelectContent>
    </Select>
    {selected && <div className="space-y-1 text-xs text-muted-foreground">
      <p className="break-all font-mono">{selected.fingerprint}</p>
      {selected.passphrase_required && <p>{t("keyPassphraseOnConnect")}</p>}
    </div>}
    <p className="text-xs text-muted-foreground">{t("keyReferenceHint")}</p>
    <div className="flex gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={() => setImporting(true)}>{t("keyImportAction")}</Button>
      {selected && <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>{t("keyDeleteAction")}</Button>}
    </div>
    {importing && <div className="space-y-3 rounded-md border p-3">
      <Label htmlFor={`${id}-name`}>{t("keyNameLabel")}</Label>
      <Input id={`${id}-name`} value={name} disabled={busy} onChange={e => setName(e.target.value)} autoComplete="off" data-bwignore="true" />
      <PrivateKeyInput id={`${id}-material`} value={material} disabled={busy} onChange={setMaterial} />
      <Label htmlFor={`${id}-passphrase`}>{t("keyPassphraseLabel")}</Label>
      <Input id={`${id}-passphrase`} type="password" value={passphrase} disabled={busy} onChange={e => setPassphrase(e.target.value)} autoComplete="off" data-bwignore="true" />
      <p className="text-xs text-muted-foreground">{t("keyPassphraseHint")}</p>
      <div className="flex gap-2">
        <Button type="button" disabled={busy} onClick={() => void importKey()}>{t("keyImportSave")}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={clearImport}>{t("quickFormCancelButton")}</Button>
      </div>
    </div>}
    {error && <div role="alert" className="text-sm text-destructive">{error}<Button type="button" variant="link" disabled={busy || loading} onClick={() => setReload(n => n + 1)}>{t("retryLoad")}</Button></div>}
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("keyDeleteAction")} description={t("keyDeleteConfirm", { name: selected?.name ?? "" })} confirmText={t("keyDeleteAction")} variant="destructive" onConfirm={() => void deleteKey()} />
  </div>
}
