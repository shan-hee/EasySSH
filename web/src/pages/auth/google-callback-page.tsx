import { PageLoading } from "@/components/page-loading"

import { Suspense, useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "@/components/ui/sonner"
import { useTranslation } from "react-i18next"
import { authApi, type AuthSessionResponse } from "@/lib/api/auth"
import { useAuthStore } from "@/stores/auth-store"
import { useSystemConfig } from "@/contexts/system-config-context"
import { getAuthErrorMessage } from "@/lib/auth-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiFetch, isApiError } from "@/lib/api-client"
import {
  buildLockedLoginRedirectUrl,
  buildLoginRedirectUrl,
  getAuthLockInfo,
  getSafeAuthNextPath,
  getSafeInternalPath,
} from "@/lib/auth-redirect"
import { AuthI18nProvider } from "@/providers/auth-i18n-provider"
import { beginAuthenticatedSession } from "@/lib/auth-session-activity"
import { resumeSessionRefresh } from "@/lib/session-refresh"

type GoogleOAuthState = {
  mode?: "login" | "link"
  next?: string | null
  returnTo?: string | null
  rememberLogin?: boolean
}

// 解析 state 中携带的 next / mode 信息
function parseState(stateParam: string | null): GoogleOAuthState {
  if (!stateParam) return {}
  try {
    const decoded = decodeURIComponent(atob(stateParam))
    const data = JSON.parse(decoded) as GoogleOAuthState
    return data && typeof data === "object" ? data : {}
  } catch {
    return {}
  }
}

function GoogleAuthCallbackInner() {
  const { t } = useTranslation("auth")
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setToken = useAuthStore((state) => state.setToken)
  const { refreshConfig } = useSystemConfig()
  const hasHandledCallback = useRef(false)
  const [mfa, setMfa] = useState<{ token: string; next: string | null } | null>(null)
  const [mfaCode, setMfaCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [mfaError, setMfaError] = useState("")

  useEffect(() => {
    if (hasHandledCallback.current) {
      return
    }
    hasHandledCallback.current = true

    const queryParams = new URLSearchParams(window.location.search)
    const code = queryParams.get("code")
    const error = queryParams.get("error")
    const state = queryParams.get("state") || searchParams.get("state")
    const parsedState = parseState(state)
    const mode = parsedState.mode === "link" ? "link" : "login"
    const next = getSafeAuthNextPath(parsedState.next)
    const returnTo = getSafeInternalPath(parsedState.returnTo) ?? "/dashboard"

    const redirectBackToLogin = (params: Record<string, string> = {}) => {
      const loginUrl = buildLoginRedirectUrl(next)
      const [path, existingQuery = ""] = loginUrl.split("?")
      const query = new URLSearchParams(existingQuery)
      for (const [key, value] of Object.entries(params)) {
        if (value) {
          query.set(key, value)
        }
      }
      const queryString = query.toString()
      navigate(queryString ? `${path}?${queryString}` : path)
    }

    const redirectBackToSettings = (params: Record<string, string> = {}) => {
      const url = new URL(returnTo, window.location.origin)
      url.searchParams.set("account_settings", "security")
      for (const [key, value] of Object.entries(params)) {
        if (value) {
          url.searchParams.set(key, value)
        }
      }
      navigate(`${url.pathname}${url.search}${url.hash}`)
    }

    if (error) {
      if (mode === "link") {
        redirectBackToSettings({
          google_link: "failed",
          google_message: t("loginGoogleFailedDesc"),
        })
      } else {
        redirectBackToLogin({
          google_error: "google_oauth_error",
          google_message: t("loginGoogleFailedDesc"),
        })
      }
      return
    }

    if (!code) {
      if (mode === "link") {
        redirectBackToSettings({
          google_link: "failed",
          google_message: t("loginGoogleCredentialMissingDesc"),
        })
      } else {
        redirectBackToLogin({
          google_error: "google_credential_missing",
          google_message: t("loginGoogleCredentialMissingDesc"),
        })
      }
      return
    }

    ;(async () => {
      try {
        const storedState = window.sessionStorage.getItem("easyssh_google_oauth_state")
        const codeVerifier = window.sessionStorage.getItem("easyssh_google_pkce_verifier")

        if (!state || !storedState || state !== storedState || !codeVerifier) {
          throw new Error("Invalid Google OAuth state")
        }

        window.sessionStorage.removeItem("easyssh_google_oauth_state")
        window.sessionStorage.removeItem("easyssh_google_pkce_verifier")

        const redirectUri = `${window.location.origin}/auth/google/callback`

        if (mode === "link") {
          await authApi.linkGoogleCode({
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
          })

          await refreshConfig({ refreshAuth: true }).catch(() => {})
          redirectBackToSettings({ google_link: "success" })
          return
        }

        const response = await authApi.verifyGoogleCode({
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          remember_login: parsedState.rememberLogin === true,
        })
        if (response.requires_2fa && response.temp_token) { setMfa({ token: response.temp_token, next }); return }
        if (!response.access_token || typeof response.expires_in !== "number") {
          throw new Error("Missing access_token in Google callback response")
        }

        setToken(response.access_token, response.expires_in)
        resumeSessionRefresh()
        beginAuthenticatedSession()

        toast.success(t("loginToastSuccessTitle"), {
          description: t("loginToastSuccessDesc"),
        })

        await refreshConfig({ refreshAuth: true }).catch(() => {})

        if (next) {
          navigate(next)
        } else {
          navigate("/dashboard")
        }
      } catch (err) {
        const message = getAuthErrorMessage(err, t, t("loginGoogleRetryDesc"))
        const apiError = isApiError(err) ? err : null
        const detail = apiError && typeof apiError.detail === "object" && apiError.detail !== null
          ? (apiError.detail as { error?: string; message?: string })
          : null
        if (detail?.error === "account_locked") {
          navigate(
            buildLockedLoginRedirectUrl(
              getAuthLockInfo(apiError?.detail),
              mode === "link" ? returnTo : next,
            ),
          )
          return
        }

        if (mode === "link") {
          redirectBackToSettings({
            google_link: detail?.error ?? "failed",
            google_message: message,
          })
        } else {
          redirectBackToLogin({
            google_error: detail?.error ?? "google_login_failed",
            google_message: message,
          })
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const verifyMFA = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!mfa || busy) return
    setBusy(true); setMfaError("")
    try {
      const session = await apiFetch<AuthSessionResponse>("/auth/2fa/verify", {
        method: "POST", body: { temp_token: mfa.token, code: mfaCode.trim() },
      })
      setToken(session.access_token, session.expires_in)
      resumeSessionRefresh(); beginAuthenticatedSession()
      setMfaCode("")
      await refreshConfig({ refreshAuth: true }).catch(() => {})
      navigate(mfa.next || "/dashboard", { replace: true })
    } catch (error) { setMfaError(getAuthErrorMessage(error, t, t("login2faToastFailedDesc"))) }
    finally { setBusy(false) }
  }

  if (mfa) return <main className="flex min-h-svh items-center justify-center px-6 py-12">
    <form className="w-full max-w-sm space-y-5" onSubmit={verifyMFA}>
      <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("login2faRequiredTitle")}</h1><p className="text-sm text-muted-foreground">{t("login2faRequiredDesc")}</p></div>
      <div className="space-y-2"><Label htmlFor="google-two-step">{t("login2faCodePlaceholder")}</Label><Input id="google-two-step" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} required autoFocus /></div>
      {mfaError && <p role="alert" className="text-sm text-destructive">{mfaError}</p>}
      <Button className="w-full" disabled={busy || !mfaCode.trim()}>{t(busy ? "login2faSubmitting" : "login2faSubmit")}</Button>
      <Button className="w-full" type="button" variant="ghost" disabled={busy} onClick={() => navigate(buildLoginRedirectUrl(mfa.next), { replace: true })}>{t("passwordBackToLogin")}</Button>
    </form>
  </main>

  return (
    <PageLoading className="min-h-screen" label={t("loginGoogleCallbackLoading")} />
  )
}

function GoogleAuthCallbackFallback() {
  const { t } = useTranslation("auth")

  return (
    <PageLoading className="min-h-screen" label={t("loginGoogleCallbackLoading")} />
  )
}

export default function GoogleAuthCallbackPage() {
  return (
    <AuthI18nProvider>
      <Suspense fallback={<GoogleAuthCallbackFallback />}>
        <GoogleAuthCallbackInner />
      </Suspense>
    </AuthI18nProvider>
  )
}
