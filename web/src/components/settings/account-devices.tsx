import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, Monitor } from "lucide-react"
import { ownerApi, type OwnerSession } from "../../lib/api/owner"
import { useSystemConfig } from "@easyssh/app/contexts/system-config-context"
import { useConfirmDialog } from "@easyssh/app/hooks/use-confirm-dialog"
import { SettingsSection } from "@easyssh/app/components/settings/settings-section"
import { Button } from "@easyssh/app/components/ui/button"
import { getErrorMessage } from "@easyssh/app/lib/error-utils"

export function AccountDevices() {
  const { t } = useTranslation("accountSettings")
  const { confirm, confirmDialog } = useConfirmDialog()
  const currentSessionId = useSystemConfig().authStatus?.session_id
  const [sessions, setSessions] = useState<OwnerSession[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    ownerApi.sessions().then((items) => { if (!cancelled) setSessions(items) })
      .catch((error) => { if (!cancelled) setError(getErrorMessage(error, t("securitySessionsLoadFailed"))) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [t])
  const revokeSession = async (id: string) => {
    if (busy || !await confirm({ title: t("sessionRevokeTitle"), description: t("sessionRevokeDescription"), confirmText: t("deviceRevoke"), variant: "destructive" })) return
    setBusy(true); setError("")
    try { await ownerApi.revokeSession(id); setSessions((items) => items.filter((session) => session.id !== id)) }
    catch (error) { setError(getErrorMessage(error, t("securitySessionsRevokeFailed"))) }
    finally { setBusy(false) }
  }
  return <div className="space-y-8">
    {confirmDialog}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <SettingsSection title={t("securitySessionsTitle")} description={t("sessionListDescription")}>
      {loading ? <Loader2 className="animate-spin text-muted-foreground" /> : sessions.length === 0 ? <p className="text-sm text-muted-foreground">{t("securitySessionsEmpty")}</p> :
        <div className="divide-y rounded-lg border">{sessions.map((session) => <div key={session.id} className="flex items-center gap-3 p-4">
          <Monitor className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{session.device_name || t("securitySessionsUnknownDevice")}{session.id === currentSessionId && <span className="ml-2 text-xs text-muted-foreground">{t("securitySessionsCurrentTag")}</span>}</div><p className="truncate text-xs text-muted-foreground">{session.ip_address}{session.location && ` · ${session.location}`}</p></div>
          {session.id !== currentSessionId && <Button size="sm" variant="outline" disabled={busy} onClick={() => revokeSession(session.id)}>{t("deviceRevoke")}</Button>}
        </div>)}</div>}
    </SettingsSection>
  </div>
}
