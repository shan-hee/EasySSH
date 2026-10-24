import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Laptop, Loader2, Server, ShieldCheck, XCircle } from "lucide-react"
import { useClientAuth } from "@/components/client-auth-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { SyncScopeOptions, scopeLabels } from "@/components/settings/sync-scopes"
import { emptySyncScopes, type SyncScopes } from "@/lib/sync/types"
import { syncRequest } from "@/lib/sync/web-adapter"

type AuthorizationInfo = { name: string; status: "pending" | "approved" | "denied" }

export default function SyncAuthorizePage() {
  const { hash } = useLocation()
  const { user } = useClientAuth()
  const code = hash.slice(1)
  // A different authorization link must never inherit another device's consent.
  return <AuthorizationRequest key={`${code}:${user?.id || ""}`} code={code} />
}

function AuthorizationRequest({ code }: { code: string }) {
  const { t } = useTranslation("settingsManagementBackup")
  const { user } = useClientAuth()
  const navigate = useNavigate()
  const [info, setInfo] = useState<AuthorizationInfo | null>(null)
  const [loadError, setLoadError] = useState("")
  const [submitError, setSubmitError] = useState("")
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState(false)
  const [operation, setOperation] = useState<"approve" | "deny" | null>(null)
  const [scopes, setScopes] = useState(emptySyncScopes)
  const mounted = useRef(false)
  const requestVersion = useRef(0)
  const submitting = useRef(false)
  const validCode = /^[0-9a-f]{64}$/i.test(code)

  const messageFor = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (message === "Authorization expired; start again" || message === "authorization expired") return t("syncAuthorizeExpiredHint")
    if (message === "revoke an existing device first (maximum 20)") return t("syncAuthorizeDeviceLimit")
    return message
  }, [t])

  const refresh = useCallback(async (background = false) => {
    const version = ++requestVersion.current
    if (!validCode) {
      setLoadError(t("syncAuthorizeInvalidHint"))
      setLoading(false)
      return null
    }
    if (!background) setLoading(true)
    try {
      const next = await syncRequest<AuthorizationInfo>("/authorization/info", {
        method: "POST",
        body: JSON.stringify({ user_code: code }),
      })
      if (!mounted.current || version !== requestVersion.current) return null
      setInfo(next)
      setLoadError("")
      if (next.status !== "pending") setSubmitError("")
      return next
    } catch (error) {
      if (mounted.current && version === requestVersion.current) setLoadError(messageFor(error))
      return null
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false)
    }
  }, [code, validCode, messageFor, t])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false; ++requestVersion.current }
  }, [refresh])

  useEffect(() => {
    if (info?.status !== "pending" || loadError) return
    // Observe expiry or cancellation in the desktop app without submitting anything.
    const timer = window.setInterval(() => {
      if (!submitting.current) void refresh(true)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [info?.status, loadError, refresh])

  const busy = operation !== null
  const canDecide = info?.status === "pending" && !loadError && !loading && !busy
  const selectedScopes = (Object.keys(scopeLabels) as (keyof SyncScopes)[]).filter((key) => scopes[key])

  async function decide(decision: "approve" | "deny") {
    if (submitting.current || !canDecide || (decision === "approve" && (!checked || !user))) return
    submitting.current = true
    ++requestVersion.current
    setOperation(decision)
    setSubmitError("")
    try {
      await syncRequest(`/authorization/${decision}`, {
        method: "POST",
        body: JSON.stringify(decision === "approve" ? { user_code: code, scopes } : { user_code: code }),
      })
      if (mounted.current) setInfo((current) => current && ({ ...current, status: decision === "approve" ? "approved" : "denied" }))
    } catch (error) {
      if (!mounted.current) return
      // A lost response can still mean approval succeeded. Read the request before
      // offering another decision, instead of treating an uncertain result as failure.
      const next = await refresh()
      if (mounted.current && next?.status === "pending") setSubmitError(messageFor(error))
    } finally {
      submitting.current = false
      if (mounted.current) setOperation(null)
    }
  }

  const backButton = (
    <Button type="button" variant="outline" onClick={() => navigate("/dashboard/terminal", { replace: true })}>
      <ArrowLeft className="size-4" />{t("syncAuthorizeBack")}
    </Button>
  )

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3 text-primary"><ShieldCheck className="size-6" /></div>
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold">{t("syncAuthorizeTitle")}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{t("syncAuthorizeDescription")}</p>
        </div>
      </header>

      {loadError ? (
        <div role="alert" className="space-y-4 rounded-xl border bg-card/40 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1"><p className="font-medium">{t("syncAuthorizeUnavailable")}</p>
              <p className="break-words text-sm leading-6 text-muted-foreground">{loadError}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {validCode && <Button disabled={loading || busy} onClick={() => void refresh()}>
              {loading && <Loader2 className="size-4 animate-spin" />}{t("syncRefreshStatus")}
            </Button>}
            {backButton}
          </div>
        </div>
      ) : !info ? (
        <div role="status" className="flex items-center gap-3 rounded-xl border bg-card/40 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />{t("syncAuthorizeLoading")}
        </div>
      ) : info.status !== "pending" ? (
        <div role="status" className="space-y-4 rounded-xl border bg-card/40 p-6">
          <div className="flex items-start gap-3">
            {info.status === "approved" ? <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-primary" /> : <XCircle className="mt-0.5 size-6 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 space-y-2">
              <h2 className="text-lg font-semibold">{t(info.status === "approved" ? "syncAuthorizeSuccess" : "syncAuthorizeDenied")}</h2>
              <p className="break-words text-sm font-medium">{info.name}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t(info.status === "approved" ? "syncAuthorizeDone" : "syncAuthorizeDeniedHint")}</p>
              {info.status === "approved" && <p className="text-sm leading-6 text-muted-foreground">{t("syncAuthorizeNextStep")}</p>}
            </div>
          </div>
          {backButton}
        </div>
      ) : (
        <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void decide("approve") }}>
          <SettingsSection title={t("syncAuthorizeVerifyTitle")} description={t("syncAuthorizeVerifyHint")}
            icon={<Laptop className="size-5" />} className="rounded-xl border border-border bg-card/40 p-5">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">{t("syncDeviceName")}</dt>
                <dd className="mt-1 break-words font-medium">{info.name}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("syncAccount")}</dt>
                <dd className="mt-1 break-all font-medium">{user?.username}</dd>
                {user?.email && <dd className="mt-1 break-all text-xs text-muted-foreground">{user.email}</dd>}</div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">{t("syncServerURL")}</dt>
                <dd className="mt-1 break-all">{window.location.origin}</dd></div>
            </dl>
            <div className="space-y-2 rounded-lg bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">{t("syncAuthorizeVerificationCode")}</p>
              <p className="select-all break-all font-mono text-2xl font-semibold tracking-[0.2em]">{code.slice(-8).toUpperCase()}</p>
              <p className="text-xs leading-5 text-muted-foreground">{t("syncAuthorizeCodeHint")}</p>
            </div>
          </SettingsSection>

          <SettingsSection title={t("syncAuthorizeScopesTitle")} description={t("syncAuthorizeScopesHint")}
            className="rounded-xl border border-border bg-card/40 p-5">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
              <Server className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-1"><p className="text-sm font-medium">{t("syncBaseTitle")}</p>
                <p className="text-xs leading-5 text-muted-foreground">{t("syncAuthorizeBaseHint")}</p></div>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5" />{t("syncAuthorizeRequired")}</span>
            </div>
            <SyncScopeOptions value={scopes} disabled={!canDecide} onChange={setScopes} />
            <p className="text-xs leading-5 text-muted-foreground">{t("syncVaultTrustHint")}</p>
          </SettingsSection>

          <SettingsSection title={t("syncAuthorizeConfirmTitle")} className="rounded-xl border border-border bg-card/40 p-5">
            <div className="space-y-2 text-sm">
              <p className="break-words">{t("syncAuthorizeGrantTo", { name: info.name, account: user?.username || "" })}</p>
              <div className="flex flex-wrap gap-2" aria-label={t("syncAuthorizeSelection")}>
                {[t("syncBaseTitle"), ...selectedScopes.map((key) => t(scopeLabels[key]))].map((label) => (
                  <span key={label} className="rounded-md bg-muted/50 px-2 py-1 text-xs">{label}</span>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{t("syncAuthorizeValidity")}</p>
            </div>
            <Label htmlFor="sync-authorize-confirm" className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox id="sync-authorize-confirm" className="mt-1" checked={checked}
                onCheckedChange={(value) => setChecked(value === true)} disabled={!canDecide} />
              <span className="text-sm font-normal leading-6">{t("syncAuthorizeCheck")}</span>
            </Label>
            {submitError && <p role="alert" className="break-words text-sm text-destructive">{submitError}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" disabled={!canDecide} onClick={() => void decide("deny")}>
                {operation === "deny" && <Loader2 className="size-4 animate-spin" />}{t("syncAuthorizeCancel")}
              </Button>
              <Button type="submit" disabled={!canDecide || !checked || !user}>
                {operation === "approve" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                {t(operation === "approve" ? "syncAuthorizeSubmitting" : "syncAuthorizeAction")}
              </Button>
            </div>
          </SettingsSection>
        </form>
      )}
    </div>
  )
}
