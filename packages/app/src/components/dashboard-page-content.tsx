import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

/**
 * 普通管理页的统一内容画布。
 *
 * 视口型工作区（终端、AI 助手）使用各自的全屏布局，不使用此组件。
 *
 * 表格页传入 `min-h-auto` 并把 DataTable 作为直接子项：画布填满可视高度，高度不够时只压缩
 * 表格行区域并在其内部滚动；概览、工具栏、分页等固定部分本身放不下时才由外层页面滚动。
 */
export function DashboardPageContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-[520px] min-w-0 flex-1 flex-col gap-4 px-4 pb-4",
        className,
      )}
      {...props}
    />
  )
}
