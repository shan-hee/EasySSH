import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { LoadingSpinner } from "@/components/ui/loading/loading-spinner"
import { useDelayedLoading } from "@/hooks/use-delayed-loading"
import { cn } from "@/lib/utils"

interface PageLoadingProps extends ComponentProps<"div"> {
  delay?: number
  label?: string
}

/** 页面与内容区加载；系统启动使用独立的 AppLoadingScreen。 */
export function PageLoading({ className, delay = 160, label, ...props }: PageLoadingProps) {
  const { t } = useTranslation("common")
  const visible = useDelayedLoading(true, delay)
  const message = label ?? t("loading")
  return (
    <div className={cn("flex min-h-64 flex-1 items-center justify-center", className)} role="status" aria-live="polite" aria-busy="true" aria-label={message} {...props}>
      {visible && <LoadingSpinner size="lg" label={message} />}
    </div>
  )
}
