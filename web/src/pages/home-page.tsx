
import { useAuthStatusRedirect } from "@/hooks/use-auth-status-redirect"
import { useSystemConfig } from "@/contexts/system-config-context"
import { AppLoadingScreen } from "@/components/app-loading"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"

export default function Home() {
  const { t } = useTranslation("common")
  const { isChecking } = useAuthStatusRedirect("home")
  const { error, refreshConfig } = useSystemConfig()

  // 显示加载状态
  if (!isChecking) {
    // 理论上首页总是会重定向,不会渲染真实内容
    // 这里返回 null 以防止在极端情况下渲染多余内容
    return null
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <p className="text-muted-foreground">{t("authStatusUnavailable")}</p>
          <Button onClick={() => void refreshConfig({ refreshAuth: true })}>
            {t("retry")}
          </Button>
        </div>
      </div>
    )
  }

  return <AppLoadingScreen />
}
