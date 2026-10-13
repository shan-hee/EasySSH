import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, Monitor } from "lucide-react"
import { sessionsApi, type Session } from "@/lib/api/sessions"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { SettingsSection } from "./settings-section"
import { Button } from "@/components/ui/button"
import { getErrorMessage } from "@/lib/error-utils"

export function AccountDevices() {
  const { t } = useTranslation("accountSettings")
  const { confirm, confirmDialog } = useConfirmDialog()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    sessionsApi.list().then((response) => { if (!cancelled) setSessions(response.sessions ?? []) })
      .catch((error) => { if (!cancelled) setError(getErrorMessage(error, t("securitySessionsLoadFailed"))) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [t])
  const revokeSession = async (id: string) => {
    if (busy || !await confirm({ title: t("sessionRevokeTitle"), description: t("sessionRevokeDescription"), confirmText: t("deviceRevoke"), variant: "destructive" })) return
    setBusy(true); setError("")
    try { await sessionsApi.revoke(id); setSessions((items) => items.filter((session) => session.id !== id)) }
    catch (error) { setError(getErrorMessage(error, t("securitySessionsRevokeFailed"))) }
    finally { setBusy(false) }
  }
  return <div className="space-y-8">
    {confirmDialog}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <SettingsSection title={t("securitySessionsTitle")} description={t("sessionListDescription")}>
      {loading ? <Loader2 className="animate-spin text-muted-foreground" /> : sessions.length === 0 ? <p className="text-sm text-muted-foreground">{t("securitySessionsEmpty")}</p> :
        <div className="divide-y rounded-lg border">{sessions.map((session) => <div key={session.id} className="flex items-center gap-3 p-4">
          <Monitor className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{session.device_name || t("securitySessionsUnknownDevice")}{session.is_current && <span className="ml-2 text-xs text-muted-foreground">{t("securitySessionsCurrentTag")}</span>}</div><p className="truncate text-xs text-muted-foreground">{session.ip_address}{session.location && ` · ${session.location}`}</p></div>
          {!session.is_current && <Button size="sm" variant="outline" disabled={busy} onClick={() => revokeSession(session.id)}>{t("deviceRevoke")}</Button>}
        </div>)}</div>}
    </SettingsSection>
  </div>
}
