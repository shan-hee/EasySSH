import type { ComponentProps } from "react"

import { Spinner } from "@/components/ui/spinner"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

interface AppLoadingProps extends ComponentProps<"div"> {
  delay?: number
  label?: string
}

/**
 * 应用级加载指示器。
 *
 * 默认延迟一小段时间再显示，避免快速路由或缓存命中时闪一下加载状态。
 */
export function AppLoadingScreen({
  className,
  delay = 160,
  label = "Loading",
  ...props
}: AppLoadingProps) {
  const reducedMotion = useReducedMotion()

  return (
    <div
      className={cn("flex min-h-svh flex-1 items-center justify-center bg-background", className)}
      role="status"
      aria-busy="true"
      aria-label={label}
      {...props}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: delay / 1000, duration: reducedMotion ? 0 : 0.1 }}
        aria-hidden="true"
      >
        <Spinner className="size-5 text-muted-foreground" />
      </motion.div>
    </div>
  )
}
