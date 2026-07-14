
import { useAuthStatusRedirect } from "@/hooks/use-auth-status-redirect"
import { useSystemConfig } from "@/contexts/system-config-context"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { getEffectiveLocale } from "@/utils/datetime"
import zhCN from "@/i18n/messages/zh-CN"
import enUS from "@/i18n/messages/en-US"

export default function Home() {
  const { isChecking } = useAuthStatusRedirect("home")
  const { config, error, refreshConfig } = useSystemConfig()

  // 显示加载状态
  if (!isChecking) {
    // 理论上首页总是会重定向,不会渲染真实内容
    // 这里返回 null 以防止在极端情况下渲染多余内容
    return null
  }

  const locale = getEffectiveLocale(undefined, config || null)
  const messages = locale === "en-US" ? enUS : zhCN

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <p className="text-muted-foreground">{messages.common.authStatusUnavailable}</p>
          <Button onClick={() => void refreshConfig({ refreshAuth: true })}>
            {messages.common.retry}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <Spinner
          aria-label={messages.common.loading}
          className="mx-auto mb-4 size-10 text-muted-foreground"
        />
        <p className="text-muted-foreground">{messages.common.loading}</p>
      </div>
    </div>
  )
}
