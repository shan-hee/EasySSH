import type { ComponentProps } from "react"
import { motion } from "motion/react"

import { Spinner } from "@/components/ui/spinner"
import { useDelayedLoading } from "@/hooks/use-delayed-loading"
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
  const visible = useDelayedLoading(true, delay)

  return (
    <div
      className={cn("flex min-h-svh flex-1 items-center justify-center bg-background", className)}
      role="status"
      aria-busy="true"
      aria-label={label}
      {...props}
    >
      {visible ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="inline-flex items-center justify-center"
          aria-hidden="true"
        >
          <Spinner className="size-5 text-muted-foreground" />
        </motion.div>
      ) : null}
    </div>
  )
}
