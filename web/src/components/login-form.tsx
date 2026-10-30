import { Spinner } from "@easyssh/app/components/ui/spinner"

import { useEffect, useState, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { cn } from "@easyssh/app/lib/utils"
import { Button } from "@easyssh/app/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@easyssh/app/components/ui/field"
import { Input } from "@easyssh/app/components/ui/input"
import { Checkbox } from "@easyssh/app/components/ui/checkbox"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@easyssh/app/components/ui/input-otp"
import { Eye, EyeOff, Lock, Mail } from "lucide-react"
import { toast } from "@easyssh/app/components/ui/sonner"
import { useSystemConfig } from "@easyssh/app/contexts/system-config-context"
import { getAuthErrorCode, getAuthErrorMessage } from "../lib/auth-error"
import { ownerApi } from "../lib/api/owner"
import { ownerSession } from "../platform/owner-session"
import { AUTHENTICATED_FALLBACK, getSafeAuthNextPath } from "../platform/auth-redirect"
import { useTranslation } from "react-i18next"
import { AuthPageFooter } from "./auth-page-footer"
import { DEFAULT_BRAND_LOGO, DEFAULT_BRAND_NAME } from "@easyssh/app/lib/brand"

const TOTP_LENGTH = 6

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { config, refreshConfig } = useSystemConfig()

  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberLogin, setRememberLogin] = useState(false)

  // 第二步：同一登录接口带上验证器验证码或备份码
  const [requires2FA, setRequires2FA] = useState(false)
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState("")

  const [lockMessage, setLockMessage] = useState("")
  const isLocked = lockMessage !== ""

  const { t: tAuth } = useTranslation("auth")

  // 登录成功后的回跳路径,优先使用 /login?next=xxx 中的 next
  const getRedirectTarget = useCallback(() => {
    return getSafeAuthNextPath(searchParams.get("next")) ?? AUTHENTICATED_FALLBACK
  }, [searchParams])

  const login = useCallback(async (code?: string) => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const result = await ownerApi.login({ email, password, remember: rememberLogin, ...(code ? { code } : {}) })
      ownerSession.begin(result.csrf_token)
      toast.success(tAuth(code ? "login2faToastSuccessTitle" : "loginToastSuccessTitle"), {
        description: tAuth(code ? "login2faToastSuccessDesc" : "loginToastSuccessDesc"),
      })
      await refreshConfig()
      navigate(getRedirectTarget(), { replace: true })
    } catch (error: unknown) {
      const errorCode = getAuthErrorCode(error)
      if (errorCode === "two_factor_required") {
        setRequires2FA(true)
      } else if (errorCode === "initialization_required") {
        navigate("/setup", { replace: true })
      } else if (errorCode === "login_temporarily_locked") {
        setLockMessage(getAuthErrorMessage(error, tAuth, tAuth("loginAccountLockedDesc")))
      } else if (code) {
        setTwoFactorCode("")
        toast.error(tAuth("login2faToastFailedTitle"), {
          description: getAuthErrorMessage(error, tAuth, tAuth("login2faToastFailedDesc")),
        })
      } else {
        toast.error(tAuth("loginToastFailedTitle"), {
          description: getAuthErrorMessage(error, tAuth, tAuth("loginToastFailedDesc")),
        })
      }
      setIsLoading(false)
    }
  }, [email, getRedirectTarget, isLoading, navigate, password, refreshConfig, rememberLogin, tAuth])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void login()
  }

  const handle2FASubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const code = twoFactorCode.trim()
    if (!code || (!useBackupCode && code.length !== TOTP_LENGTH)) {
      toast.error(tAuth("login2faToastCodeRequired"))
      return
    }
    void login(code)
  }

  // 返回到账号密码登录
  const handleBack = () => {
    setRequires2FA(false)
    setUseBackupCode(false)
    setTwoFactorCode("")
    setPassword("")
  }

  const toggleBackupCode = () => {
    setUseBackupCode((current) => !current)
    setTwoFactorCode("")
  }

  // 验证器验证码输入满 6 位时自动提交
  useEffect(() => {
    if (requires2FA && !useBackupCode && twoFactorCode.length === TOTP_LENGTH && !isLoading) {
      void login(twoFactorCode)
    }
  }, [isLoading, login, requires2FA, twoFactorCode, useBackupCode])

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={requires2FA ? handle2FASubmit : handleSubmit}>
        <FieldGroup>
          {/* Logo 和标题 */}

            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-16 items-center justify-center">
                  <img
                    src={config?.system_logo || DEFAULT_BRAND_LOGO}
                    alt={`${config?.system_name || DEFAULT_BRAND_NAME} Logo`}
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


          {/* 表单卡片：去掉背景色与边框/阴影 */}
          <div className="rounded-xl p-6 bg-transparent">
            {requires2FA ? (
              // 2FA 验证表单
              <div className="space-y-4">

                  <Field>
                    <FieldLabel htmlFor="2fa-code" className="text-foreground">
                      {tAuth(useBackupCode ? "login2faBackupCodeLabel" : "login2faCodePlaceholder")}
                    </FieldLabel>
                    {useBackupCode ? (
                      <Input
                        id="2fa-code"
                        autoComplete="one-time-code"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={32}
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(e.target.value)}
                        className="text-center font-mono tracking-widest"
                        autoFocus
                      />
                    ) : (
                      <div className="flex justify-center">
                        <InputOTP
                          id="2fa-code"
                          maxLength={TOTP_LENGTH}
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
                    )}
                    <FieldDescription className="text-center text-xs text-muted-foreground">
                      {tAuth("login2faRequiredDesc")}
                    </FieldDescription>
                  </Field>


                {/* 验证按钮 */}

                  <Field>
                    <Button
                      type="submit"
                      disabled={isLoading || (useBackupCode ? twoFactorCode.trim() === "" : twoFactorCode.length !== TOTP_LENGTH)}
                      className="w-full"
                      size="lg"
                    >
                      {isLoading ? (
                        <>
                          <span className="mr-2">{tAuth("login2faSubmitting")}</span>
                          {/* spinner 文案已在上方 label 中体现 */}
                          <Spinner aria-hidden="true" />
                        </>
                      ) : (
                        tAuth("login2faSubmit")
                      )}
                    </Button>
                  </Field>


                {/* 返回按钮 */}

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


                {/* 备份码提示 */}

                  <div className="text-center">
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs text-muted-foreground"
                      onClick={toggleBackupCode}
                      disabled={isLoading}
                    >
                      {tAuth(useBackupCode ? "login2faUseAuthenticator" : "login2faBackupHint")}
                    </Button>
                  </div>

              </div>
            ) : (
              // 邮箱密码登录表单
              <div className="space-y-4">
              {/* 账户锁定提示 */}
              {isLocked && (

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
                            {lockMessage}
                          </p>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/50"
                          onClick={() => setLockMessage("")}
                        >
                          {tAuth("loginAccountLockedRetry")}
                        </Button>
                      </div>
                    </div>
                  </div>

              )}

              {/* 邮箱输入 */}

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


              {/* 密码输入 */}

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


              {/* 登录持久性 */}

                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={rememberLogin}
                    onCheckedChange={(checked) => setRememberLogin(checked === true)}
                    aria-label={tAuth("loginRememberMe")}
                  />
                  <span>{tAuth("loginRememberMe")}</span>
                </label>


              {/* 登录按钮 */}

                <Field>
                  <Button
                    type="submit"
                    disabled={isLoading || isLocked}
                    className="w-full"
                    size="lg"
                  >
                    {isLoading ? (
                        <>
                          <span className="mr-2">{tAuth("loginSubmitting")}</span>
                        <Spinner aria-hidden="true" />
                      </>
                      ) : (
                      tAuth("loginSubmit")
                    )}
                  </Button>
                </Field>


            </div>
            )}
          </div>

          {/* 版本信息 */}
          {!requires2FA && <AuthPageFooter />}
        </FieldGroup>
      </form>
    </div>
  )
}
