import { useState } from "react"
import { useTranslation } from "react-i18next"
import { QRCodeSVG } from "qrcode.react"
import { Loader2 } from "lucide-react"
import { SettingsSection } from "./settings-section"
import { AccountPassword } from "./account-password"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useClientAuth } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/contexts/system-config-context"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { authApi } from "@/lib/api/auth"
import { twoFactorApi } from "@/lib/api/2fa"
import { generateCodeVerifier, deriveCodeChallenge } from "@/lib/pkce"
import { getErrorMessage } from "@/lib/error-utils"
import { toast } from "sonner"

function GoogleAccount() {
  const { t } = useTranslation("accountSettings")
  const { user, refreshUser } = useClientAuth()
  const { config } = useSystemConfig()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [busy, setBusy] = useState(false)
  const link = async () => {
    if (busy || !config?.google_client_id) return
    setBusy(true)
    try {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const state = btoa(encodeURIComponent(JSON.stringify({ mode: "link", returnTo, ts: Date.now() })))
      const verifier = generateCodeVerifier()
      const challenge = await deriveCodeChallenge(verifier)
      sessionStorage.setItem("easyssh_google_pkce_verifier", verifier)
      sessionStorage.setItem("easyssh_google_oauth_state", state)
      const params = new URLSearchParams({ client_id: config.google_client_id, redirect_uri: `${window.location.origin}/auth/google/callback`, response_type: "code", scope: "openid email profile", prompt: "select_account", code_challenge: challenge, code_challenge_method: "S256", state })
      window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
    } catch (error) { toast.error(getErrorMessage(error, t("securityGoogleLinkFailed"))); setBusy(false) }
  }
  const unlink = async () => {
    if (!await confirm({ title: t("securityGoogleUnlinkConfirmTitle"), description: t("securityGoogleUnlinkConfirmDescription"), confirmText: t("securityGoogleUnlinkButton"), variant: "destructive" })) return
    setBusy(true)
    try { await authApi.unlinkGoogle(); await refreshUser() }
    catch (error) { toast.error(getErrorMessage(error, t("securityGoogleUnlinkFailed"))) }
    finally { setBusy(false) }
  }
  if (!user?.google_linked && !config?.oauth_enabled) return null
  return <SettingsSection title={t("securityGoogleTitle")}>
    {confirmDialog}
    <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">{t(user?.google_linked ? "securityGoogleStatusLinked" : "securityGoogleStatusUnlinked")}</span><Button variant="outline" disabled={busy} onClick={user?.google_linked ? unlink : link}>{busy && <Loader2 className="animate-spin" />}{t(user?.google_linked ? "securityGoogleUnlinkButton" : "securityGoogleLinkButton")}</Button></div>
  </SettingsSection>
}

function TwoStepVerification() {
  const { t } = useTranslation("accountSettings")
  const { user, refreshUser } = useClientAuth()
  const [stage, setStage] = useState<"setup" | "disable" | "backup" | undefined>()
  const [secret, setSecret] = useState("")
  const [qr, setQR] = useState("")
  const [code, setCode] = useState("")
  const [backup, setBackup] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const start = async () => {
    setError(""); setCode("")
    if (user?.two_factor_enabled) { setStage("disable"); return }
    setBusy(true)
    try { const response = await twoFactorApi.generateSecret(); setSecret(response.secret); setQR(response.qr_code_url); setStage("setup") }
    catch (error) { toast.error(getErrorMessage(error, t("security2faGenerateFailed"))) }
    finally { setBusy(false) }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError("")
    try {
      if (stage === "setup") { const response = await twoFactorApi.enable(code); setBackup(response.backup_codes); setStage("backup") }
      else { await twoFactorApi.disable(code); setStage(undefined) }
      setCode(""); setSecret(""); setQR(""); await refreshUser()
    } catch (error) { setError(getErrorMessage(error, t(stage === "setup" ? "security2faEnableFailed" : "security2faDisableFailed"))) }
    finally { setBusy(false) }
  }
  const close = () => { setStage(undefined); setCode(""); setSecret(""); setQR(""); setBackup([]); setError("") }
  return <SettingsSection title={t("security2faTitle")} description={t("security2faDescription")}>
    <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">{t(user?.two_factor_enabled ? "security2faStatusEnabled" : "security2faStatusDisabled")}</span><Button variant="outline" disabled={busy} onClick={start}>{t(user?.two_factor_enabled ? "security2faDisableDialogConfirm" : "security2faEnableButton")}</Button></div>
    <Dialog open={!!stage} onOpenChange={(open) => { if (!open && !busy && stage !== "backup") close() }}>
      <DialogContent className="sm:max-w-md"><DialogTitle>{t(stage === "backup" ? "security2faBackupDialogTitle" : stage === "disable" ? "security2faDisableDialogTitle" : "security2faTitle")}</DialogTitle><DialogDescription>{t(stage === "backup" ? "security2faBackupDialogDescription" : stage === "disable" ? "security2faDisableDialogDescription" : "security2faDescription")}</DialogDescription>
        {stage === "backup" ? <div className="space-y-4"><div className="grid grid-cols-2 gap-2">{backup.map((value) => <code className="rounded border p-2 text-center text-sm" key={value}>{value}</code>)}</div><Button className="w-full" variant="outline" onClick={() => navigator.clipboard.writeText(backup.join("\n")).catch(() => {})}>{t("security2faBackupCopyAllButton")}</Button><Button className="w-full" onClick={close}>{t("security2faBackupSavedButton")}</Button></div> :
          <form onSubmit={submit} className="space-y-4">
            {stage === "setup" && <><div className="mx-auto w-fit rounded-lg bg-white p-3"><QRCodeSVG value={qr} size={160} /></div><code className="block break-all text-center text-xs">{secret}</code></>}
            <Label htmlFor="account-two-step">{t("security2faCodeInputLabel")}</Label><Input id="account-two-step" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy || !code}>{busy && <Loader2 className="animate-spin" />}{t(stage === "disable" ? "security2faDisableDialogConfirm" : "security2faEnableButton")}</Button>
          </form>}
      </DialogContent>
    </Dialog>
  </SettingsSection>
}

export function AccountSecurity() {
  return <div className="space-y-8"><AccountPassword /><TwoStepVerification /><GoogleAccount /></div>
}
