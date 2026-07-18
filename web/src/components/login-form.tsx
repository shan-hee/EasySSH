
import { useEffect, useState, useCallback, useRef } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp"
import { Eye, EyeOff, Lock, Mail } from "lucide-react"
import { toast } from "@/components/ui/sonner"
import { useSystemConfig } from "@/contexts/system-config-context"
import { authApi, INTERNAL_OAUTH_REDIRECT_URI } from "@/lib/api/auth"
import { twoFactorApi } from "@/lib/api/2fa"
import { FadeSlideIn } from "@/components/ui/fade-slide-in"
import { getErrorMessage } from "@/lib/error-utils"
import { getAuthErrorCode, getAuthErrorMessage } from "@/lib/auth-error"
import { isApiError } from "@/lib/api-client"
import { generateCodeVerifier, deriveCodeChallenge } from "@/lib/pkce"
import { useAuthStore } from "@/stores/auth-store"
import { resetUnauthorizedRedirectFlag, resetAccountLockedRedirectFlag } from "@/lib/api-client"
import { buildLoginRedirectUrl, getSafeAuthNextPath } from "@/lib/auth-redirect"
import { useTranslation } from "react-i18next"
import { beginAuthenticatedSession } from "@/lib/auth-session-activity"
import { resumeSessionRefresh } from "@/lib/session-refresh"
import { AuthPageFooter } from "@/components/auth-page-footer"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { config, refreshConfig } = useSystemConfig()
  const setToken = useAuthStore((state) => state.setToken)

  // 为避免预取到“未登录”的缓存结果，删除预取 dashboard 的逻辑

  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberLogin, setRememberLogin] = useState(false)

  // 2FA 相关状态（PKCE + 2FA）
  const [requires2FA, setRequires2FA] = useState(false)
  const [tempToken, setTempToken] = useState("")
  const [twoFactorCode, setTwoFactorCode] = useState("")

  // 账户锁定状态
  const [isAccountLocked, setIsAccountLocked] = useState(false)
  const [lockReason, setLockReason] = useState<string | null>(null)
  const [lockMessage, setLockMessage] = useState("")
  const [unlockAt, setUnlockAt] = useState<string | null>(null)

  // PKCE 状态，在 2FA 流程中复用
  const [codeVerifier, setCodeVerifier] = useState("")
  const [pkceState, setPkceState] = useState("")
  const [redirectUri, setRedirectUri] = useState("")
  const handledGoogleErrorRef = useRef<string | null>(null)
  const handledSessionTimeoutRef = useRef(false)

  const { t: tAuth } = useTranslation("auth")
  const rememberLoginAllowed = config?.tab_session?.remember_login === true
  const isOAuthAuthorization = searchParams.has("oauth_client_id")

  const redirectWithAuthorizationCode = useCallback((code: string, state: string, callbackURL: string) => {
    const callback = new URL(callbackURL)
    callback.searchParams.set("code", code)
    if (state) {
      callback.searchParams.set("state", state)
    }
    window.location.assign(callback.toString())
  }, [])

  useEffect(() => {
    if (!rememberLoginAllowed) {
      setRememberLogin(false)
    }
  }, [rememberLoginAllowed])

  // 登录成功后的回跳路径,优先使用 /login?next=xxx 中的 next
  const getRedirectTarget = useCallback(() => {
    return getSafeAuthNextPath(searchParams.get("next")) ?? "/dashboard"
  }, [searchParams])

  // 进入登录表单时，重置全局重定向标记，开始新的认证周期
  useEffect(() => {
    resetUnauthorizedRedirectFlag()
    resetAccountLockedRedirectFlag()
  }, [])

  // 检查 URL 参数是否包含 locked=true（从其他页面被锁定后跳转过来）
  useEffect(() => {
    const lockedParam = searchParams.get("locked")
    if (lockedParam === "true") {
      setIsAccountLocked(true)
      setLockMessage(tAuth("loginAccountLockedDesc"))
      // 获取锁定原因
      const lockReasonParam = searchParams.get("lock_reason")
      if (lockReasonParam) {
        setLockReason(lockReasonParam)
      }
      // 获取锁定时间
      const lockedUntilParam = searchParams.get("locked_until")
      if (lockedUntilParam) {
        setUnlockAt(lockedUntilParam)
      }
    }
  }, [searchParams, tAuth])

  useEffect(() => {
    const googleError = searchParams.get("google_error")
    if (!googleError) {
      return
    }

    const googleMessage = searchParams.get("google_message") || ""
    const errorKey = `${googleError}:${googleMessage}`
    if (handledGoogleErrorRef.current === errorKey) {
      return
    }
    handledGoogleErrorRef.current = errorKey

    const message = googleMessage || tAuth("loginGoogleRetryDesc")
    toast.error(tAuth("loginGoogleFailedTitle"), {
      description: message,
    })

    navigate(buildLoginRedirectUrl(searchParams.get("next")), { replace: true })
  }, [navigate, searchParams, tAuth])

  useEffect(() => {
    if (searchParams.get("session_timeout") !== "true" || handledSessionTimeoutRef.current) {
      return
    }
    handledSessionTimeoutRef.current = true
    toast.warning(tAuth("loginSessionTimeoutTitle"), {
      description: tAuth("loginSessionTimeoutDesc"),
    })
  }, [searchParams, tAuth])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // 避免重复提交
    if (isLoading) return

    setIsLoading(true)

    try {
      // 内置 Web Client 自行生成 PKCE；外部 Client 的 verifier 由 Client 自己保管，登录页只接收 challenge。
      const verifier = isOAuthAuthorization ? "" : generateCodeVerifier()
      const challenge = isOAuthAuthorization
        ? searchParams.get("oauth_code_challenge") ?? ""
        : await deriveCodeChallenge(verifier)
      const state = isOAuthAuthorization
        ? searchParams.get("oauth_state") ?? ""
        : generateCodeVerifier(32)
      const clientID = isOAuthAuthorization
        ? searchParams.get("oauth_client_id") ?? ""
        : "easyssh-web"
      const responseType = isOAuthAuthorization
        ? searchParams.get("oauth_response_type") ?? "code"
        : "code"
      const ru = isOAuthAuthorization
        ? searchParams.get("oauth_redirect_uri") ?? ""
        : INTERNAL_OAUTH_REDIRECT_URI
      const scope = isOAuthAuthorization
        ? searchParams.get("oauth_scope") ?? "openid profile easyssh"
        : "openid profile easyssh"
      const nonce = isOAuthAuthorization ? searchParams.get("oauth_nonce") ?? "" : ""

      // 保存 PKCE 参数供 2FA 步骤复用
      setCodeVerifier(verifier)
      setPkceState(state)
      setRedirectUri(ru)

      // 2. 调用 /oauth/authorize：根据是否启用 2FA 决定流程
      const authorizeResp = await authApi.authorizeWithPkce({
        email,
        password,
        response_type: responseType,
        client_id: clientID,
        redirect_uri: ru,
        scope,
        code_challenge: challenge,
        code_challenge_method: isOAuthAuthorization
          ? searchParams.get("oauth_code_challenge_method") ?? "S256"
          : "S256",
        state,
        nonce,
        remember_login: rememberLoginAllowed && rememberLogin,
      })

      // 启用 2FA：进入第二步
      if (authorizeResp.requires_2fa && authorizeResp.temp_token) {
        setTempToken(authorizeResp.temp_token)
        setRequires2FA(true)
        toast.info(tAuth("login2faRequiredTitle"), {
          description: tAuth("login2faRequiredDesc"),
        })
        setIsLoading(false)
        return
      }

      // 未启用 2FA：直接使用授权码换取 access_token
      if (!authorizeResp.code) {
        throw new Error("AUTH_CODE_EMPTY")
      }

      if (isOAuthAuthorization) {
        redirectWithAuthorizationCode(authorizeResp.code, state, ru)
        return
      }

      const tokenResp = await authApi.exchangeCodeForToken({
        code: authorizeResp.code,
        client_id: clientID,
        redirect_uri: ru,
        code_verifier: verifier,
      })

      if (!tokenResp.access_token) {
        throw new Error("ACCESS_TOKEN_MISSING")
      }

      setToken(tokenResp.access_token, tokenResp.expires_in)
      resumeSessionRefresh()
      beginAuthenticatedSession()

      toast.success(tAuth("loginToastSuccessTitle"), {
        description: tAuth("loginToastSuccessDesc"),
      })
      // 刷新全局 authStatus/system_config
      await refreshConfig({ refreshAuth: true })
      navigate(getRedirectTarget(), { replace: true })
    } catch (error: unknown) {
      // 检查是否为账户锁定错误
      if (isApiError(error) && error.status === 429) {
        const detail = error.detail as { unlock_at?: string } | undefined
        const errorCode = getAuthErrorCode(error)
        if (errorCode === "account_locked" || errorCode === "ip_locked") {
          setIsAccountLocked(true)
          setLockMessage(getAuthErrorMessage(error, tAuth, tAuth("loginAccountLockedDesc")))
          if (detail?.unlock_at) {
            setUnlockAt(detail.unlock_at)
          }
          setIsLoading(false)
          return
        }
      }

      toast.error(tAuth("loginToastFailedTitle"), {
        description: getAuthErrorMessage(error, tAuth, tAuth("loginToastFailedDesc")),
      })
      setIsLoading(false)
    }
  }

  // 处理 2FA 表单提交
  const handle2FASubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (isLoading) return

    if (!twoFactorCode || twoFactorCode.length !== 6) {
      toast.error(tAuth("login2faToastCodeRequired"))
      return
    }

    setIsLoading(true)

    try {
      const verifyResp = await twoFactorApi.verifyLogin({
        tempToken,
        code: twoFactorCode,
      })

      if (!verifyResp.code) {
        // 内部异常，给用户看统一的失败提示
        throw new Error("2FA verification succeeded but no authorization code was returned")
      }

      if (isOAuthAuthorization) {
        redirectWithAuthorizationCode(verifyResp.code, pkceState, redirectUri)
        return
      }

      const tokenResp = await authApi.exchangeCodeForToken({
        code: verifyResp.code,
        client_id: "easyssh-web",
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      })

      if (!tokenResp.access_token) {
        throw new Error("Missing access_token in token response")
      }

      setToken(tokenResp.access_token, tokenResp.expires_in)
      resumeSessionRefresh()
      beginAuthenticatedSession()

      toast.success(tAuth("login2faToastSuccessTitle"), {
        description: tAuth("login2faToastSuccessDesc"),
      })

      await refreshConfig({ refreshAuth: true })
      navigate(getRedirectTarget())
    } catch (error: unknown) {
      toast.error(tAuth("login2faToastFailedTitle"), {
        description: getAuthErrorMessage(error, tAuth, tAuth("login2faToastFailedDesc")),
      })
    } finally {
      setIsLoading(false)
    }
  }, [
    codeVerifier,
    getRedirectTarget,
    isLoading,
    isOAuthAuthorization,
    pkceState,
    redirectWithAuthorizationCode,
    redirectUri,
    refreshConfig,
    navigate,
    setToken,
    tAuth,
    tempToken,
    twoFactorCode,
  ])

  // 返回到账号密码登录
  const handleBack = () => {
    setRequires2FA(false)
    setTempToken("")
    setTwoFactorCode("")
    setPassword("")
  }

  // 启动基于重定向的 Google OIDC Authorization Code + PKCE 登录
  const handleGoogleRedirectLogin = async () => {
    if (!config?.oauth_enabled || !config?.google_client_id) {
      toast.error(tAuth("loginGoogleNotEnabledTitle"), {
        description: tAuth("loginGoogleNotEnabledDesc"),
      })
      return
    }

    try {
      const redirectUri = `${window.location.origin}/auth/google/callback`

      const next = getSafeAuthNextPath(searchParams.get("next"))

      const statePayload = {
        next,
        rememberLogin: rememberLoginAllowed && rememberLogin,
      }

      const state = btoa(
        encodeURIComponent(JSON.stringify(statePayload)),
      )
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await deriveCodeChallenge(codeVerifier)

      window.sessionStorage.setItem("easyssh_google_pkce_verifier", codeVerifier)
      window.sessionStorage.setItem("easyssh_google_oauth_state", state)

      const params = new URLSearchParams({
        client_id: config.google_client_id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        prompt: "select_account",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      })

      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    } catch (error) {
      toast.error(tAuth("loginGoogleFailedTitle"), {
        description: getErrorMessage(error, tAuth("loginGoogleFailedDesc")),
      })
    }
  }

  // 监听 2FA 验证码输入，长度达到 6 位时自动提交
  useEffect(() => {
    if (twoFactorCode.length === 6 && requires2FA && !isLoading) {
      void (async () => {
        await handle2FASubmit()
      })()
    }
  }, [twoFactorCode, requires2FA, isLoading, handle2FASubmit])

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={requires2FA ? handle2FASubmit : handleSubmit}>
        <FieldGroup>
          {/* Logo 和标题 */}
          <FadeSlideIn delay={0} disabled>
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-16 items-center justify-center">
                  <img
                    src={config?.system_logo || "/logo.svg"}
                    alt={`${config?.system_name || "EasySSH"} Logo`}
                    width={64}
                    height={64}
                    className="size-16 transition-opacity duration-200"
                    style={{
                      // 防止闪烁: 设置固定尺寸避免布局偏移
                      width: '64px',
                      height: '64px',
                      // 使用 will-change 提示浏览器优化
                      willChange: 'opacity',
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold text-foreground">
                    {requires2FA
                      ? tAuth("login2faRequiredTitle")
                      : tAuth("loginTitle") + " " + (config?.system_name || "EasySSH")}
                  </h1>
                  {requires2FA && (
                    <p className="text-sm text-muted-foreground">
                      {tAuth("login2faRequiredDesc")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </FadeSlideIn>

          {/* 表单卡片：去掉背景色与边框/阴影 */}
          <div className="rounded-xl p-6 bg-transparent">
            {requires2FA ? (
              // 2FA 验证表单
              <div className="space-y-4">
                <FadeSlideIn delay={0.1} disabled>
                  <Field>
                    <FieldLabel htmlFor="2fa-code" className="text-foreground">
                      {tAuth("login2faCodePlaceholder")}
                    </FieldLabel>
                    <div className="flex justify-center">
                      <InputOTP
                        maxLength={6}
                        value={twoFactorCode}
                        onChange={(value) => setTwoFactorCode(value)}
                        autoFocus
                      >
                        <InputOTPGroup>
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                        </InputOTPGroup>
                        <InputOTPSeparator />
                        <InputOTPGroup>
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <FieldDescription className="text-center text-xs text-muted-foreground">
                      {tAuth("login2faRequiredDesc")}
                    </FieldDescription>
                  </Field>
                </FadeSlideIn>

                {/* 验证按钮 */}
                <FadeSlideIn delay={0.2} disabled>
                  <Field>
                    <Button
                      type="submit"
                      disabled={isLoading || twoFactorCode.length !== 6}
                      className="w-full"
                      size="lg"
                    >
                      {isLoading ? (
                        <>
                          <span className="mr-2">{tAuth("login2faSubmitting")}</span>
                          {/* spinner 文案已在上方 label 中体现 */}
                          <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                        </>
                      ) : (
                        tAuth("login2faSubmit")
                      )}
                    </Button>
                  </Field>
                </FadeSlideIn>

                {/* 返回按钮 */}
                <FadeSlideIn delay={0.3} disabled>
                  <Field>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBack}
                      className="w-full"
                      disabled={isLoading}
                    >
                      {tAuth("login2faBack")}
                    </Button>
                  </Field>
                </FadeSlideIn>

                {/* 备份码提示 */}
                <FadeSlideIn delay={0.4} disabled>
                  <div className="text-center text-xs text-muted-foreground">
                    {tAuth("login2faBackupHint")}
                  </div>
                </FadeSlideIn>
              </div>
            ) : (
              // 邮箱密码登录表单
              <div className="space-y-4">
              {/* 账户锁定提示 */}
              {isAccountLocked && (
                <FadeSlideIn delay={0} disabled>
                  <div className="rounded-xl border border-red-200/50 dark:border-red-900/50 bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/30 dark:to-red-900/20 p-5 shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 p-2 rounded-full bg-red-100 dark:bg-red-900/50">
                        <Lock className="h-5 w-5 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="flex-1 space-y-3">
                        <div>
                          <h3 className="text-base font-semibold text-red-800 dark:text-red-200">
                            {tAuth("loginAccountLockedTitle")}
                          </h3>
                          <p className="mt-1 text-sm text-red-700/90 dark:text-red-300/90">
                            {lockMessage || tAuth("loginAccountLockedDesc")}
                          </p>
                        </div>

                        {/* 锁定详情 */}
                        {(lockReason || unlockAt) && (
                          <div className="space-y-2 pt-2 border-t border-red-200/50 dark:border-red-800/50">
                            {lockReason && (
                              <div className="flex items-start gap-2 text-sm">
                                <span className="text-red-600/70 dark:text-red-400/70 shrink-0">{tAuth("loginAccountLockedReason")}:</span>
                                <span className="font-medium text-red-700 dark:text-red-300">
                                  {lockReason}
                                </span>
                              </div>
                            )}
                            {unlockAt && (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-red-600/70 dark:text-red-400/70">{tAuth("loginAccountLockedUnlockAt")}:</span>
                                <span className="font-medium text-red-700 dark:text-red-300">
                                  {new Date(unlockAt).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/50"
                          onClick={() => {
                            setIsAccountLocked(false)
                            setLockMessage("")
                            setLockReason(null)
                            setUnlockAt(null)
                          }}
                        >
                          {tAuth("loginAccountLockedRetry")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </FadeSlideIn>
              )}

              {/* 邮箱输入 */}
              <FadeSlideIn delay={0.1} disabled>
                <Field>
                  <FieldLabel htmlFor="email" className="text-foreground">
                    {tAuth("loginEmailLabel")}
                  </FieldLabel>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder={tAuth("loginEmailPlaceholder")}
                      name="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="border-input bg-card/80 pl-10 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50"
                      required
                    />
                  </div>
                </Field>
              </FadeSlideIn>

              {/* 密码输入 */}
              <FadeSlideIn delay={0.2} disabled>
                <Field>
                  <FieldLabel htmlFor="password" className="text-foreground">
                    {tAuth("loginPasswordLabel")}
                  </FieldLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={tAuth("loginPasswordPlaceholder")}
                      name="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="border-input bg-card/80 pl-10 pr-10 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </Field>
              </FadeSlideIn>

              {/* 登录持久性与忘记密码 */}
              <FadeSlideIn delay={0.3} disabled>
                <div className="flex items-center justify-between gap-4">
                  {rememberLoginAllowed ? (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={rememberLogin}
                        onCheckedChange={(checked) => setRememberLogin(checked === true)}
                        aria-label={tAuth("loginRememberMe")}
                      />
                      <span>{tAuth("loginRememberMe")}</span>
                    </label>
                  ) : (
                    <span />
                  )}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground hover:no-underline"
                    onClick={() => navigate("/forgot-password")}
                  >
                    {tAuth("loginForgotPassword")}
                  </Button>
                </div>
              </FadeSlideIn>

              {/* 登录按钮 */}
              <FadeSlideIn delay={0.4} disabled>
                <Field>
                  <Button
                    type="submit"
                    disabled={isLoading || isAccountLocked}
                    className="w-full"
                    size="lg"
                  >
                    {isLoading ? (
                        <>
                          <span className="mr-2">{tAuth("loginSubmitting")}</span>
                        <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      </>
                      ) : (
                      tAuth("loginSubmit")
                    )}
                  </Button>
                </Field>
              </FadeSlideIn>

              {/* Google 登录 */}
              {!isOAuthAuthorization && config?.oauth_enabled && config?.google_client_id && (
                <>
                  <FadeSlideIn delay={0.5} disabled>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 border-t border-border" />
                      <span className="text-xs uppercase text-muted-foreground">
                        {tAuth("loginDividerOr")}
                      </span>
                      <div className="flex-1 border-t border-border" />
                    </div>
                  </FadeSlideIn>

                  <FadeSlideIn delay={0.6} disabled>
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full max-w-[384px]"
                        size="lg"
                        onClick={handleGoogleRedirectLogin}
                      >
                        <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                          <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="currentColor"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="currentColor"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          />
                          <path
                            fill="currentColor"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                        {tAuth("loginWithGoogle")}
                      </Button>
                    </div>
                  </FadeSlideIn>

                </>
              )}
            </div>
            )}
          </div>

          {/* 底部提示 */}
          {!requires2FA && (
            <div className="space-y-3">

            {/* 注册提示 */}
            <FadeSlideIn delay={0.5} disabled>
              <div className="text-center text-sm text-muted-foreground">
                {tAuth("loginNoAccount")}
                {config?.allow_registration ? (
                  <Button
                    type="button"
                    variant="link"
                    className="ml-1 h-auto p-0 text-muted-foreground no-underline transition-colors hover:text-foreground hover:no-underline"
                    onClick={() => navigate("/register")}
                  >
                    {tAuth("loginRegisterNow")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    className="ml-1 h-auto p-0 text-muted-foreground no-underline transition-colors hover:text-foreground hover:no-underline"
                    onClick={() => {
                      toast.info(tAuth("loginApplyAccountToastTitle"), {
                        description: tAuth("loginApplyAccountToastDesc"),
                      })
                    }}
                  >
                    {tAuth("loginApplyAccount")}
                  </Button>
                )}
              </div>
            </FadeSlideIn>

            {/* 版本信息 */}
            <FadeSlideIn delay={0.6} disabled>
              <AuthPageFooter />
            </FadeSlideIn>
          </div>
          )}
        </FieldGroup>
      </form>
    </div>
  )
}
