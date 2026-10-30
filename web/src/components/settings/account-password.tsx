import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2 } from "lucide-react"
import { Button } from "@easyssh/app/components/ui/button"
import { Input } from "@easyssh/app/components/ui/input"
import { Field, FieldLabel } from "@easyssh/app/components/ui/field"
import { SettingsSection } from "@easyssh/app/components/settings/settings-section"
import { ownerApi } from "../../lib/api/owner"
import { ownerSession } from "../../platform/owner-session"
import { toast } from "sonner"
import { getErrorMessage } from "@easyssh/app/lib/error-utils"

export function AccountPassword() {
  const { t } = useTranslation("accountSettings")
  const { t: tAuth } = useTranslation("auth")
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (newPassword !== confirmation) { setError(t("securityPasswordMismatch")); return }
    if ([...newPassword].length < 9) { setError(tAuth("passwordLengthHint")); return }
    setBusy(true); setError("")
    try {
      await ownerApi.changePassword({ old_password: oldPassword, new_password: newPassword })
      // 修改密码会撤销包括当前会话在内的所有会话，重新加载到登录页以清空本地状态。
      toast.success(t("securityPasswordChanged"))
      ownerSession.end()
      window.location.assign("/login")
    } catch (error) { setError(getErrorMessage(error, t("securityPasswordChangeFailed"))) }
    finally { setBusy(false) }
  }
  return <SettingsSection title={t("securityPasswordTitle")} description={t("securityPasswordDescription")}>
    <form className="max-w-md space-y-4" onSubmit={submit}>
      <Field><FieldLabel htmlFor="password-current">{t("securityCurrentPasswordLabel")}</FieldLabel><Input id="password-current" type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required /></Field>
      <Field><FieldLabel htmlFor="password-new">{t("securityNewPasswordLabel")}</FieldLabel><Input id="password-new" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></Field>
      <Field><FieldLabel htmlFor="password-confirm">{t("securityConfirmPasswordLabel")}</FieldLabel><Input id="password-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy}>{busy && <Loader2 className="animate-spin" />}{t("securitySavePasswordButton")}</Button>
    </form>
  </SettingsSection>
}
