import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useSystemConfig } from "@/contexts/system-config-context"
import { authApi } from "@/lib/api/auth"
import { getErrorMessage } from "@/lib/error-utils"
import { AuthPageFooter } from "@/components/auth-page-footer"
import { toast } from "@/components/ui/sonner"

export function RegisterForm({ className, ...props }: React.ComponentProps<"div">) {
  const navigate = useNavigate()
  const { config } = useSystemConfig()
  const { t } = useTranslation("auth")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const requiresEmail = config?.require_email_verification === true
  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])
  const sendCode = async () => {
    setSending(true); setError("")
    try { await authApi.sendVerificationCode(email); setCountdown(60) }
    catch (error) { setError(getErrorMessage(error, t("registerToastCodeFailedDesc"))) }
    finally { setSending(false) }
  }
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError("")
    if (password !== confirmation) { setError(t("registerToastPasswordMismatchDesc")); return }
    if ([...password].length < 9) { setError(t("passwordLengthHint")); return }
    if (requiresEmail && verificationCode.length !== 6) { setError(t("registerToastCodeInvalidDesc")); return }
    setBusy(true)
    try {
      await authApi.register({ email, password, verification_code: requiresEmail ? verificationCode : undefined })
      setPassword(""); setConfirmation("")
      toast.success(t("registerToastSuccessTitle"))
      navigate("/login", { replace: true })
    } catch (error) { setError(getErrorMessage(error, t("registerToastFailedDesc"))) }
    finally { setBusy(false) }
  }
  return <div className={cn("space-y-6", className)} {...props}>
    <form className="space-y-5" onSubmit={prepare}>
        <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("registerTitle", { systemName: config?.system_name || "EasySSH" })}</h1><p className="text-sm text-muted-foreground">{t("registerDescription")}</p></div>
        <Field><FieldLabel htmlFor="register-email">{t("registerEmailLabel")}</FieldLabel><Input id="register-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        {requiresEmail && <Field><FieldLabel htmlFor="register-code">{t("registerVerificationCodeLabel")}</FieldLabel><div className="flex gap-2"><Input id="register-code" autoComplete="one-time-code" inputMode="numeric" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required /><Button type="button" variant="outline" onClick={sendCode} disabled={sending || countdown > 0 || !email}>{countdown > 0 ? `${countdown}s` : t("registerSendCode")}</Button></div></Field>}
        <Field><FieldLabel htmlFor="register-password">{t("registerPasswordLabel")}</FieldLabel><Input id="register-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><p className="text-xs text-muted-foreground">{t("passwordLengthHint")}</p></Field>
        <Field><FieldLabel htmlFor="register-confirm">{t("registerConfirmPasswordLabel")}</FieldLabel><Input id="register-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{t("registerSubmit")}</Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => navigate("/login")}>{t("passwordBackToLogin")}</Button>
      </form>
    <AuthPageFooter />
  </div>
}
