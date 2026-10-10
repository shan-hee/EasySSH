import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { RefreshCw } from "lucide-react"
import { useClientAuth } from "@/components/client-auth-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { SyncScopeOptions } from "@/components/settings/sync-scopes"
import { emptySyncScopes } from "@/lib/sync/types"
import { syncRequest } from "@/lib/sync/web-adapter"

export default function SyncAuthorizePage() {
  const { t } = useTranslation("settingsManagementBackup")
  const { user } = useClientAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const code = location.hash.slice(1)
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [approved, setApproved] = useState(false)
  const [scopes, setScopes] = useState(emptySyncScopes)
  useEffect(() => {
    let cancelled = false
    void syncRequest<{ name: string; status: string }>("/authorization/info", {
      method: "POST",
      body: JSON.stringify({ user_code: code }),
    })
      .then((result) => {
        if (!cancelled) {
          setName(result.name)
          setApproved(result.status === "approved")
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [code])
  async function approve() {
    setBusy(true)
    try {
      await syncRequest("/authorization/approve", {
        method: "POST",
        body: JSON.stringify({ user_code: code, scopes }),
      })
      setApproved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="p-4">
      <SettingsSection
        title={t("syncAuthorizeTitle")}
        description={t("syncAuthorizeDescription")}
        icon={<RefreshCw className="h-5 w-5" />}
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {approved ? (
          <p className="text-sm">{t("syncAuthorizeDone")}</p>
        ) : (
          <>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("syncAccount")}</dt>
                <dd>
                  {user?.username} · {user?.email}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("syncDeviceName")}</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("syncServerURL")}</dt>
                <dd>{window.location.origin}</dd>
              </div>
            </dl>
            <p className="font-mono text-xl tracking-widest">{code.slice(-8).toUpperCase()}</p>
            <p className="text-sm text-muted-foreground">{t("syncScope")}</p>
            <SyncScopeOptions value={scopes} disabled={busy} onChange={setScopes} />
            <p className="text-sm text-muted-foreground">{t("syncVaultTrustHint")}</p>
            <Label className="flex items-start gap-3">
              <Checkbox
                checked={checked}
                onCheckedChange={(value) => setChecked(value === true)}
                disabled={busy}
              />
              <span className="text-sm leading-6">{t("syncAuthorizeCheck")}</span>
            </Label>
            <div className="flex gap-2">
              <Button
                disabled={busy || !checked || !name || !!error}
                onClick={() => void approve()}
              >
                {t("syncAuthorizeAction")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void syncRequest("/authorization/deny", {
                    method: "POST",
                    body: JSON.stringify({ user_code: code }),
                  })
                    .then(() => navigate("/dashboard/terminal", { replace: true }))
                    .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setBusy(false))
                }}
              >
                {t("syncAuthorizeCancel")}
              </Button>
            </div>
          </>
        )}
      </SettingsSection>
    </div>
  )
}
