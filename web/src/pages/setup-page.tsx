import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { authApi } from "@/lib/api/auth"
import { useSystemConfig } from "@/contexts/system-config-context"
import { getAuthRedirectDecision, getCurrentBrowserPath } from "@/lib/auth-redirect"
import { useAuthStore } from "@/stores/auth-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { AuthI18nProvider } from "@/providers/auth-i18n-provider"
import { beginAuthenticatedSession } from "@/lib/auth-session-activity"
import { resumeSessionRefresh } from "@/lib/session-refresh"
import { DEFAULT_BRAND_LOGO } from "@/lib/brand"
import { getErrorMessage } from "@/lib/error-utils"

function SetupPageInner() {
  const { t } = useTranslation("setup")
  const navigate = useNavigate()
  const { authStatus, isLoading, config, refreshConfig } = useSystemConfig()
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const completed = useRef(false)
  useEffect(() => {
    if (isLoading || !authStatus || busy || completed.current) return
    const decision = getAuthRedirectDecision("setup", authStatus, { currentPath: getCurrentBrowserPath() })
    if (decision.type === "redirect") navigate(decision.href, { replace: true })
  }, [authStatus, isLoading, busy, navigate])
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError("")
    if (password !== confirmation) { setError(t("passwordMismatch")); return }
    if ([...password].length < 9) { setError(t("passwordLength")); return }
    setBusy(true)
    try {
      const response = await authApi.initializeAdmin({ username, email, password })
      useAuthStore.getState().setToken(response.access_token, response.expires_in)
      resumeSessionRefresh(); beginAuthenticatedSession()
      completed.current = true
      setPassword(""); setConfirmation("")
      await refreshConfig({ refreshAuth: true }).catch(() => {})
      navigate("/dashboard", { replace: true })
    } catch (error) { setError(getErrorMessage(error, t("failed"))) }
    finally { setBusy(false) }
  }
  return <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12">
    <div className="w-full max-w-sm space-y-8">
      <img src={config?.system_logo || DEFAULT_BRAND_LOGO} alt={config?.system_name || "EasySSH"} className="size-12" />
      {isLoading ? <Loader2 className="animate-spin text-muted-foreground" /> :
        <form onSubmit={prepare} className="space-y-6">
          <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="text-sm text-muted-foreground">{t("description")}</p></div>
          <Field><FieldLabel htmlFor="setup-name">{t("username")}</FieldLabel><Input id="setup-name" autoComplete="nickname" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={50} required /></Field>
          <Field><FieldLabel htmlFor="setup-email">{t("email")}</FieldLabel><Input id="setup-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field><FieldLabel htmlFor="setup-password">{t("password")}</FieldLabel><Input id="setup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><p className="text-xs text-muted-foreground">{t("passwordHint")}</p></Field>
          <Field><FieldLabel htmlFor="setup-confirm">{t("confirmPassword")}</FieldLabel><Input id="setup-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{t("continue")}</Button>
        </form>}
    </div>
  </main>
}

export default function SetupPage() { return <AuthI18nProvider><SetupPageInner /></AuthI18nProvider> }
