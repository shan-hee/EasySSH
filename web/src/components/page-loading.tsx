import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { LoadingSpinner } from "@/components/ui/loading/loading-spinner"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

interface PageLoadingProps extends ComponentProps<"div"> {
  delay?: number
  label?: string
}

/** 页面与内容区加载；系统启动使用独立的 AppLoadingScreen。 */
export function PageLoading({ className, delay = 160, label, ...props }: PageLoadingProps) {
  const { t } = useTranslation("common", { useSuspense: false })
  const reducedMotion = useReducedMotion()
  const message = label ?? t("loading")
  return (
    <div className={cn("flex min-h-64 flex-1 items-center justify-center", className)} role="status" aria-live="polite" aria-busy="true" aria-label={message} {...props}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay / 1000, duration: reducedMotion ? 0 : 0.1 }}>
        <LoadingSpinner size="lg" label={message} />
      </motion.div>
    </div>
  )
}
