import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface LoadingSpinnerProps {
  /**
   * 尺寸变体
   * - sm: 16px (用于紧凑内容区)
   * - md: 24px (用于卡片内)
   * - lg: 32px (用于页面级)
   * - xl: 48px (用于全屏)
   */
  size?: "sm" | "md" | "lg" | "xl"
  /**
   * 显示在圆环下方的文字；无文字加载使用 ui/spinner 的分段式图标。
   */
  label: string
  /**
   * 自定义类名
   */
  className?: string
  /**
   * 文本类名
   */
  labelClassName?: string
}

const sizeMap = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
  xl: "size-12",
}

/**
 * LoadingSpinner - 带文字的 Lucide 圆环加载指示器。
 * 无文字场景使用 Spinner，保持两种明确的公共加载样式。
 *
 * @example
 * // 页面级加载
 * <LoadingSpinner size="lg" label="正在加载数据..." />
 *
 * @example
 * // 全屏加载
 * <div className="flex items-center justify-center min-h-screen">
 *   <LoadingSpinner size="xl" label="正在加载..." />
 * </div>
 */
export function LoadingSpinner({
  size = "md",
  label,
  className,
  labelClassName,
}: LoadingSpinnerProps) {
  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <Loader2 aria-hidden="true" className={cn(sizeMap[size], "animate-spin text-muted-foreground")} />
      <p className={cn("text-sm text-muted-foreground", labelClassName)}>
        {label}
      </p>
    </div>
  )
}
