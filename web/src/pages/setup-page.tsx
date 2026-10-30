import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Check } from "lucide-react"
import { Spinner } from "@easyssh/app/components/ui/spinner"
import { ownerApi } from "../lib/api/owner"
import { ownerSession } from "../platform/owner-session"
import { useSystemConfig } from "@easyssh/app/contexts/system-config-context"
import { AUTHENTICATED_FALLBACK, getAuthRedirectDecision, getCurrentBrowserPath } from "../platform/auth-redirect"
import { Button } from "@easyssh/app/components/ui/button"
import { Input } from "@easyssh/app/components/ui/input"
import { Field, FieldLabel } from "@easyssh/app/components/ui/field"
import { AuthI18nProvider } from "../providers/auth-i18n-provider"
import { DEFAULT_BRAND_LOGO } from "@easyssh/app/lib/brand"
import { getErrorMessage } from "@easyssh/app/lib/error-utils"
import { AnimatedStateText } from "@easyssh/app/components/motion/animated-state-text"

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
      const result = await ownerApi.initialize({ username, email, password })
      ownerSession.begin(result.csrf_token)
      setPhase("created")
      await refreshConfig()
      await navigate(AUTHENTICATED_FALLBACK, { replace: true })
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
