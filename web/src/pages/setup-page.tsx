import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Check } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
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
import { AnimatedStateText } from "@/components/motion/animated-state-text"

type SetupPhase = "idle" | "creating" | "created"

function SetupPageInner() {
  const { t } = useTranslation("setup")
  const navigate = useNavigate()
  const { authStatus, isLoading, config, refreshConfig } = useSystemConfig()
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [phase, setPhase] = useState<SetupPhase>("idle")
  const [error, setError] = useState("")
  const busy = phase !== "idle"
  const created = phase === "created"
  useEffect(() => {
    if (isLoading || !authStatus || busy) return
    const decision = getAuthRedirectDecision("setup", authStatus, { currentPath: getCurrentBrowserPath() })
    if (decision.type === "redirect") navigate(decision.href, { replace: true })
  }, [authStatus, isLoading, busy, navigate])
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError("")
    if (password !== confirmation) { setError(t("passwordMismatch")); return }
    if ([...password].length < 9) { setError(t("passwordLength")); return }
    setPhase("creating")
    try {
      const response = await authApi.initializeAdmin({ username, email, password })
      useAuthStore.getState().setToken(response.access_token, response.expires_in)
      resumeSessionRefresh(); beginAuthenticatedSession()
      setPhase("created")
      await refreshConfig({ refreshAuth: true })
      await navigate("/dashboard", { replace: true })
    } catch (error) {
      setError(getErrorMessage(error, t("failed")))
      setPhase("idle")
    }
  }
  return <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12">
    <div className="w-full max-w-sm space-y-8">
      <img src={config?.system_logo || DEFAULT_BRAND_LOGO} alt={config?.system_name || "EasySSH"} className="mx-auto size-12 object-contain" />
      {isLoading && !authStatus && !busy ? <Spinner className="mx-auto size-6 text-muted-foreground" /> :
        <form onSubmit={prepare} className="space-y-6" aria-busy={busy}>
          <div className="space-y-2 text-center"><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="text-sm text-muted-foreground">{t("description")}</p></div>
          <Field><FieldLabel htmlFor="setup-name">{t("username")}</FieldLabel><Input id="setup-name" autoComplete="nickname" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={50} readOnly={busy} required /></Field>
          <Field><FieldLabel htmlFor="setup-email">{t("email")}</FieldLabel><Input id="setup-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={busy} required /></Field>
          <Field><FieldLabel htmlFor="setup-password">{t("password")}</FieldLabel><Input id="setup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} readOnly={busy} required /><p className="text-xs text-muted-foreground">{t("passwordHint")}</p></Field>
          <Field><FieldLabel htmlFor="setup-confirm">{t("confirmPassword")}</FieldLabel><Input id="setup-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} readOnly={busy} required /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full disabled:opacity-100" disabled={busy}>
            <AnimatedStateText value={created ? "created" : phase}>
              <span className="inline-flex items-center justify-center gap-2">
                {created ? <Check aria-hidden="true" /> : busy ? <Spinner aria-hidden="true" /> : null}
                {t(created ? "created" : busy ? "createAdminSubmitting" : "continue")}
              </span>
            </AnimatedStateText>
          </Button>
        </form>}
    </div>
  </main>
}

export default function SetupPage() { return <AuthI18nProvider><SetupPageInner /></AuthI18nProvider> }
