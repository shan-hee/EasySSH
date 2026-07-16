
import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react"
import { toast } from "@/components/ui/sonner"
import { useSystemConfig } from "@/contexts/system-config-context"
import { authApi } from "@/lib/api/auth"
import { FadeSlideIn } from "@/components/ui/fade-slide-in"
import { getErrorMessage } from "@/lib/error-utils"
import { useTranslation } from "react-i18next"
import { AuthPageFooter } from "@/components/auth-page-footer"

export function RegisterForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate()
  const { config, refreshConfig } = useSystemConfig()
  const { t: tAuth } = useTranslation("auth")

  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)

  // 倒计时效果
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  // 发送验证码
  const handleSendCode = async () => {
    // 验证邮箱格式
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(tAuth("registerToastEmailInvalidTitle"), {
        description: tAuth("registerToastEmailInvalidDesc"),
      })
      return
    }

    setIsSendingCode(true)

    try {
      await authApi.sendVerificationCode(email)
      toast.success(tAuth("registerToastCodeSentTitle"), {
        description: tAuth("registerToastCodeSentDesc"),
      })
      setCountdown(60) // 60秒倒计时
    } catch (error: unknown) {
      console.error("Send code error:", error)
      toast.error(tAuth("registerToastCodeFailedTitle"), {
        description: getErrorMessage(error, tAuth("registerToastCodeFailedDesc")),
      })
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // 避免重复提交
    if (isLoading) return

    // 验证密码匹配
    if (password !== confirmPassword) {
      toast.error(tAuth("registerToastPasswordMismatchTitle"), {
        description: tAuth("registerToastPasswordMismatchDesc"),
      })
      return
    }

    // 验证密码长度
    if (password.length < 6) {
      toast.error(tAuth("registerToastPasswordTooShortTitle"), {
        description: tAuth("registerToastPasswordTooShortDesc"),
      })
      return
    }

    setIsLoading(true)

    // 验证验证码
    if (!verificationCode || verificationCode.length !== 6) {
      toast.error(tAuth("registerToastCodeInvalidTitle"), {
        description: tAuth("registerToastCodeInvalidDesc"),
      })
      return
    }

    try {
      // 调用注册 API（用户名由后端自动生成）
      await authApi.register({
        email,
        password,
        verification_code: verificationCode,
      })

      toast.success(tAuth("registerToastSuccessTitle"), {
        description: tAuth("registerToastSuccessDesc"),
      })

      // 刷新系统配置
      await refreshConfig()

      // 跳转到登录页面
      setTimeout(() => {
        navigate("/login")
      }, 1000)
    } catch (error: unknown) {
      console.error("Register error:", error)
      toast.error(tAuth("registerToastFailedTitle"), {
        description: getErrorMessage(error, tAuth("registerToastFailedDesc")),
      })
      setIsLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          {/* Logo 和标题 */}
          <FadeSlideIn disabled>
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
                      width: '64px',
                      height: '64px',
                      willChange: 'opacity',
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold text-foreground">
                    {tAuth("registerTitle", {
                      systemName: config?.system_name || "EasySSH",
                    })}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {tAuth("registerSubtitle")}
                  </p>
                </div>
              </div>
            </div>
          </FadeSlideIn>

          {/* 表单卡片 */}
          <div className="rounded-xl p-6 bg-transparent">
            <div className="space-y-4">
              {/* 邮箱输入 */}
              <FadeSlideIn disabled>
                <Field>
                  <FieldLabel htmlFor="email" className="text-foreground">
                    {tAuth("registerEmailLabel")}
                  </FieldLabel>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder={tAuth("registerEmailPlaceholder")}
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

              {/* 验证码输入 */}
              <FadeSlideIn disabled>
                <Field>
                  <FieldLabel htmlFor="verificationCode" className="text-foreground">
                    {tAuth("registerVerificationCodeLabel")}
                  </FieldLabel>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <ShieldCheck className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="verificationCode"
                        type="text"
                        placeholder={tAuth("registerVerificationCodePlaceholder")}
                        name="verificationCode"
                        autoComplete="off"
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="border-input bg-card/80 pl-10 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50"
                        required
                        maxLength={6}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSendCode}
                      disabled={isSendingCode || countdown > 0 || !email}
                      className="whitespace-nowrap"
                    >
                      {isSendingCode ? (
                        <span>{tAuth("registerSendingCode")}</span>
                      ) : countdown > 0 ? (
                        <span>{countdown}s</span>
                      ) : (
                        <span>{tAuth("registerSendCode")}</span>
                      )}
                    </Button>
                  </div>
                </Field>
              </FadeSlideIn>

              {/* 密码输入 */}
              <FadeSlideIn disabled>
                <Field>
                  <FieldLabel htmlFor="password" className="text-foreground">
                    {tAuth("registerPasswordLabel")}
                  </FieldLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={tAuth("registerPasswordPlaceholder")}
                      name="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="border-input bg-card/80 pl-10 pr-10 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50"
                      required
                      minLength={6}
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

              {/* 确认密码输入 */}
              <FadeSlideIn disabled>
                <Field>
                  <FieldLabel htmlFor="confirmPassword" className="text-foreground">
                    {tAuth("registerConfirmPasswordLabel")}
                  </FieldLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder={tAuth("registerConfirmPasswordPlaceholder")}
                      name="confirmPassword"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="border-input bg-card/80 pl-10 pr-10 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </Field>
              </FadeSlideIn>

              {/* 注册按钮 */}
              <FadeSlideIn disabled>
                <Field>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full"
                    size="lg"
                  >
                    {isLoading ? (
                      <>
                        <span className="mr-2">{tAuth("registerSubmitting")}</span>
                        <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      </>
                    ) : (
                      tAuth("registerSubmit")
                    )}
                  </Button>
                </Field>
              </FadeSlideIn>
            </div>
          </div>

          {/* 底部提示 */}
          <div className="space-y-3">
            {/* 登录提示 */}
            <FadeSlideIn disabled>
              <div className="text-center text-sm text-muted-foreground">
                {tAuth("registerHaveAccount")}
                <Button
                  type="button"
                  variant="link"
                  className="ml-1 h-auto p-0 text-muted-foreground no-underline transition-colors hover:text-foreground hover:no-underline"
                  onClick={() => navigate("/login")}
                >
                  {tAuth("registerGoLogin")}
                </Button>
              </div>
            </FadeSlideIn>

            {/* 版本信息 */}
            <FadeSlideIn disabled>
              <AuthPageFooter />
            </FadeSlideIn>
          </div>
        </FieldGroup>
      </form>
    </div>
  )
}
