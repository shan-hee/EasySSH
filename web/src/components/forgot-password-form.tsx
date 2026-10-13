import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authApi } from "@/lib/api/auth"
import { getErrorMessage } from "@/lib/error-utils"
import { toast } from "@/components/ui/sonner"

export function ForgotPasswordForm({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useTranslation("auth")
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState("")
  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])
  const sendCode = async () => {
    if (sending || countdown > 0) return
    setSending(true); setError("")
    try { await authApi.sendPasswordResetCode({ email }); setCountdown(60); toast.success(t("passwordResetCodeSent")) }
    catch (error) { setError(getErrorMessage(error, t("passwordResetFailed"))) }
    finally { setSending(false) }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError("")
    if (password !== confirmation) { setError(t("registerToastPasswordMismatchDesc")); return }
    if ([...password].length < 9) { setError(t("passwordLengthHint")); return }
    setBusy(true)
    try {
      await authApi.resetPassword({ email, verification_code: code, new_password: password })
      setPassword(""); setCode(""); setConfirmation("")
      toast.success(t("passwordResetSuccess"))
      navigate("/login", { replace: true })
    } catch (error) { setError(getErrorMessage(error, t("passwordResetFailed"))) }
    finally { setBusy(false) }
  }
  return <div className={cn("space-y-6", className)} {...props}>
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("passwordResetTitle")}</h1><p className="text-sm leading-6 text-muted-foreground">{t("passwordResetDescription")}</p></div>
    <form className="space-y-5" onSubmit={submit}>
      <Field><FieldLabel htmlFor="reset-email">{t("registerEmailLabel")}</FieldLabel><Input id="reset-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field><FieldLabel htmlFor="reset-code">{t("registerVerificationCodeLabel")}</FieldLabel><div className="flex gap-2"><Input id="reset-code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required /><Button type="button" variant="outline" onClick={sendCode} disabled={sending || countdown > 0 || !email}>{countdown > 0 ? countdown + "s" : t("registerSendCode")}</Button></div></Field>
      <Field><FieldLabel htmlFor="reset-password">{t("passwordNewLabel")}</FieldLabel><Input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><p className="text-xs text-muted-foreground">{t("passwordLengthHint")}</p></Field>
      <Field><FieldLabel htmlFor="reset-confirm">{t("registerConfirmPasswordLabel")}</FieldLabel><Input id="reset-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{t("passwordResetSubmit")}</Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => navigate("/login")}>{t("passwordBackToLogin")}</Button>
    </form>
  </div>
}
