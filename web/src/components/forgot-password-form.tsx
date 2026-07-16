
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
import { AuthPageFooter } from "@/components/auth-page-footer"

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate()
  const { config } = useSystemConfig()

  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [email, setEmail] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
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
      toast.error("邮箱格式无效", {
        description: "请输入有效的邮箱地址",
      })
      return
    }

    setIsSendingCode(true)

    try {
      await authApi.sendPasswordResetCode({ email })
      toast.success("验证码已发送", {
        description: "请查收您的邮箱",
      })
      setCountdown(60) // 60秒倒计时
    } catch (error: unknown) {
      console.error("Send code error:", error)
      toast.error("发送验证码失败", {
        description: getErrorMessage(error, "无法发送验证码，请稍后重试"),
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
    if (newPassword !== confirmPassword) {
      toast.error("密码不匹配", {
        description: "两次输入的密码不一致",
      })
      return
    }

    // 验证密码长度
    if (newPassword.length < 8) {
      toast.error("密码过短", {
        description: "密码长度至少为 8 个字符",
      })
      return
    }

    // 验证密码复杂度
    const hasUpper = /[A-Z]/.test(newPassword)
    const hasLower = /[a-z]/.test(newPassword)
    const hasDigit = /[0-9]/.test(newPassword)

    if (!hasUpper || !hasLower || !hasDigit) {
      toast.error("密码复杂度不足", {
        description: "密码必须包含大写字母、小写字母和数字",
      })
      return
    }

    // 验证验证码
    if (!verificationCode || verificationCode.length !== 6) {
      toast.error("验证码无效", {
        description: "请输入 6 位数字验证码",
      })
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    try {
      // 调用重置密码 API
      await authApi.resetPassword({
        email,
        verification_code: verificationCode,
        new_password: newPassword,
      })

      toast.success("密码重置成功", {
        description: "您现在可以使用新密码登录",
      })

      // 跳转到登录页面
      setTimeout(() => {
        navigate("/login")
      }, 1000)
    } catch (error: unknown) {
      console.error("Reset password error:", error)
      toast.error("密码重置失败", {
        description: getErrorMessage(error, "无法重置密码，请稍后重试"),
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
                    重置密码
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    输入您的邮箱地址以重置密码
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
                    邮箱地址
                  </FieldLabel>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
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
                    验证码
                  </FieldLabel>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <ShieldCheck className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="verificationCode"
                        type="text"
                        placeholder="输入 6 位验证码"
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
                        <span>发送中...</span>
                      ) : countdown > 0 ? (
                        <span>{countdown}s</span>
                      ) : (
                        <span>发送验证码</span>
                      )}
                    </Button>
                  </div>
                </Field>
              </FadeSlideIn>

              {/* 新密码输入 */}
              <FadeSlideIn disabled>
                <Field>
                  <FieldLabel htmlFor="newPassword" className="text-foreground">
                    新密码
                  </FieldLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder="输入新密码"
                      name="newPassword"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="border-input bg-card/80 pl-10 pr-10 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50"
                      required
                      minLength={8}
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
                    确认新密码
                  </FieldLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="再次输入新密码"
                      name="confirmPassword"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="border-input bg-card/80 pl-10 pr-10 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50"
                      required
                      minLength={8}
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

              {/* 重置按钮 */}
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
                        <span className="mr-2">重置中...</span>
                        <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      </>
                    ) : (
                      "重置密码"
                    )}
                  </Button>
                </Field>
              </FadeSlideIn>
            </div>
          </div>

          {/* 底部提示 */}
          <div className="space-y-3">
            {/* 返回登录 */}
            <FadeSlideIn disabled>
              <div className="text-center text-sm text-muted-foreground">
                记起密码了？
                <Button
                  type="button"
                  variant="link"
                  className="ml-1 h-auto p-0 text-muted-foreground no-underline transition-colors hover:text-foreground hover:no-underline"
                  onClick={() => navigate("/login")}
                >
                  返回登录
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
