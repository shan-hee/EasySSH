import { useState } from "react"
import { useTranslation } from "react-i18next"
import { QRCodeSVG } from "qrcode.react"
import { Loader2 } from "lucide-react"
import { SettingsSection } from "@easyssh/app/components/settings/settings-section"
import { AccountPassword } from "./account-password"
import { Button } from "@easyssh/app/components/ui/button"
import { Input } from "@easyssh/app/components/ui/input"
import { Label } from "@easyssh/app/components/ui/label"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@easyssh/app/components/ui/dialog"
import { useClientAuth } from "@easyssh/app/components/client-auth-provider"
import { ownerApi } from "../../lib/api/owner"
import { getErrorMessage } from "@easyssh/app/lib/error-utils"

type TwoFactorStage = "password" | "setup" | "disable" | "backup"

function TwoStepVerification() {
  const { t } = useTranslation("accountSettings")
  const { user, refreshUser } = useClientAuth()
  const [stage, setStage] = useState<TwoFactorStage | undefined>()
  const [password, setPassword] = useState("")
  const [secret, setSecret] = useState("")
  const [otpauthURI, setOtpauthURI] = useState("")
  const [code, setCode] = useState("")
  const [backup, setBackup] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const start = () => {
    setError(""); setCode(""); setPassword("")
    setStage(user?.two_factor_enabled ? "disable" : "password")
  }
  // 启用分三步：验证当前密码取得密钥，验证器验证码确认后返回一次性恢复码。
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError("")
    try {
      if (stage === "password") {
        const setup = await ownerApi.setupTwoFactor(password)
        setPassword(""); setSecret(setup.secret); setOtpauthURI(setup.otpauth_uri); setStage("setup")
      } else if (stage === "setup") {
        setBackup(await ownerApi.enableTwoFactor(code.trim()))
        setStage("backup"); setCode(""); setSecret(""); setOtpauthURI("")
        await refreshUser()
      } else {
        await ownerApi.disableTwoFactor(code.trim())
        setStage(undefined); setCode("")
        await refreshUser()
      }
    } catch (error) {
      setError(getErrorMessage(error, t(stage === "password" ? "security2faGenerateFailed" : stage === "setup" ? "security2faEnableFailed" : "security2faDisableFailed")))
    } finally { setBusy(false) }
  }
  const close = () => { setStage(undefined); setPassword(""); setCode(""); setSecret(""); setOtpauthURI(""); setBackup([]); setError("") }
  return <SettingsSection title={t("security2faTitle")} description={t("security2faDescription")}>
    <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">{t(user?.two_factor_enabled ? "security2faStatusEnabled" : "security2faStatusDisabled")}</span><Button variant="outline" disabled={busy || !user} onClick={start}>{t(user?.two_factor_enabled ? "security2faDisableDialogConfirm" : "security2faEnableButton")}</Button></div>
    <Dialog open={!!stage} onOpenChange={(open) => { if (!open && !busy && stage !== "backup") close() }}>
      <DialogContent className="sm:max-w-md"><DialogTitle>{t(stage === "backup" ? "security2faBackupDialogTitle" : stage === "disable" ? "security2faDisableDialogTitle" : "security2faTitle")}</DialogTitle><DialogDescription>{t(stage === "backup" ? "security2faBackupDialogDescription" : stage === "disable" ? "security2faDisableDialogDescription" : stage === "password" ? "security2faPasswordDescription" : "security2faQrDialogDescription")}</DialogDescription>
        {stage === "backup" ? <div className="space-y-4"><div className="grid grid-cols-2 gap-2">{backup.map((value) => <code className="rounded border p-2 text-center text-sm" key={value}>{value}</code>)}</div><Button className="w-full" variant="outline" onClick={() => navigator.clipboard.writeText(backup.join("\n")).catch(() => {})}>{t("security2faBackupCopyAllButton")}</Button><Button className="w-full" onClick={close}>{t("security2faBackupSavedButton")}</Button></div> :
          <form onSubmit={submit} className="space-y-4">
            {stage === "password" ? <>
              <Label htmlFor="account-two-step-password">{t("securityCurrentPasswordLabel")}</Label><Input id="account-two-step-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </> : <>
              {stage === "setup" && <><div className="mx-auto w-fit rounded-lg bg-white p-3"><QRCodeSVG value={otpauthURI} size={160} /></div><code className="block break-all text-center text-xs">{secret}</code></>}
              <Label htmlFor="account-two-step">{t(stage === "disable" ? "security2faDisableCodeLabel" : "security2faCodeInputLabel")}</Label><Input id="account-two-step" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy || (stage === "password" ? !password : !code.trim())}>{busy && <Loader2 className="animate-spin" />}{t(stage === "disable" ? "security2faDisableDialogConfirm" : stage === "password" ? "security2faContinueButton" : "security2faEnableButton")}</Button>
          </form>}
      </DialogContent>
    </Dialog>
  </SettingsSection>
}

export function AccountSecurity() {
  return <div className="space-y-8"><AccountPassword /><TwoStepVerification /></div>
}
